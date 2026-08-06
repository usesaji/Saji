/**
 * Reconciles the off-chain database with on-chain contract state.
 *
 * Ported from `backend/app/Services/Stellar/ChainIndexer.php`.
 *
 * The contract is the source of truth. Money actions can settle on-chain
 * through paths that never told the backend (a wallet signing outside the app,
 * a failed confirm call, a manual invoke). This indexer polls each on-chain
 * group's state and brings the DB into line regardless of how the change
 * happened, so group status, contributions, and the activity feed stay
 * accurate.
 *
 * It is IDEMPOTENT: running it repeatedly makes no further changes once the DB
 * matches the chain. That property is what makes it safe to run from a cron
 * that may overlap or retry.
 *
 * State-polling rather than event-log streaming: simpler, self-correcting, and
 * it needs no cursor persisted between runs — which matters on serverless,
 * where there is no long-lived process to hold one.
 */

import { prisma } from "../db";
import {
	fromStroops,
	getGroup,
	getMembers,
	getPool,
	getTransactionStatus,
	hasContributed,
} from "./service";
import type { OnchainGroup } from "./service";

/** Contract Status enum → our DB status string. */
const STATUS_MAP = ["draft", "open", "active", "completed"] as const;

export interface IndexSummary {
	groups_checked: number;
	status_updated: number;
	contributions_confirmed: number;
	txns_finalized: number;
	errors: number;
}

/**
 * Reconcile every group that is live on-chain, or just one when `groupId` is
 * given (the targeted fast path used right after a user action).
 */
export async function runIndexer(groupId?: bigint): Promise<IndexSummary> {
	const summary: IndexSummary = {
		groups_checked: 0,
		status_updated: 0,
		contributions_confirmed: 0,
		txns_finalized: 0,
		errors: 0,
	};

	const groups = await prisma.group.findMany({
		where: {
			onchainGroupId: { not: null },
			...(groupId !== undefined && { id: groupId }),
		},
	});

	for (const group of groups) {
		summary.groups_checked += 1;

		try {
			const result = await reconcileGroup(group.id, group.onchainGroupId!);
			summary.status_updated += result.statusUpdated;
			summary.contributions_confirmed += result.contributionsConfirmed;
		} catch (error) {
			// GroupNotFound (Error #1) means the recorded on-chain id has no
			// matching contract group — a stale record, not an indexer failure.
			// Skip it quietly rather than counting an error.
			if (String(error).includes("Error(Contract, #1)")) continue;

			summary.errors += 1;
			console.warn(`[indexer] group ${group.id} failed:`, error);
		}
	}

	summary.txns_finalized = await finalizePendingTransactions();

	return summary;
}

async function reconcileGroup(
	dbGroupId: bigint,
	onchainGroupId: bigint,
): Promise<{ statusUpdated: number; contributionsConfirmed: number }> {
	const state: OnchainGroup = await getGroup(onchainGroupId);

	let statusUpdated = 0;
	let contributionsConfirmed = 0;

	const group = await prisma.group.findUnique({ where: { id: dbGroupId } });
	if (!group) return { statusUpdated, contributionsConfirmed };

	// --- Status and cycle -------------------------------------------------
	const chainStatus = STATUS_MAP[state.status] ?? "open";
	const chainCycle = Number(state.current_cycle ?? 0);

	if (group.status !== chainStatus || group.currentCycle !== chainCycle) {
		await prisma.group.update({
			where: { id: group.id },
			data: { status: chainStatus, currentCycle: chainCycle },
		});
		statusUpdated = 1;
	}

	// --- Members ----------------------------------------------------------
	// Map on-chain addresses back to users so a wallet that joined outside the
	// app still shows up as a member. Addresses with no linked user are
	// skipped, not invented.
	let memberAddresses: string[] = [];
	try {
		memberAddresses = await getMembers(onchainGroupId);
	} catch {
		memberAddresses = state.members ?? [];
	}

	for (const [index, address] of memberAddresses.entries()) {
		const user = await prisma.user.findUnique({
			where: { stellarAddress: address },
		});
		if (!user) continue;

		await prisma.groupMember.upsert({
			where: { groupId_userId: { groupId: group.id, userId: user.id } },
			create: {
				groupId: group.id,
				userId: user.id,
				status: "active",
				payoutPosition: index + 1,
				joinedAt: new Date(),
			},
			update: { status: "active", payoutPosition: index + 1 },
		});
	}

	// --- Contributions for the current cycle ------------------------------
	// The chain knows only "did this member pay this cycle". Flip matching DB
	// rows to confirmed, and create rows for payments made outside the app.
	if (chainStatus === "active" && chainCycle > 0) {
		const members = await prisma.groupMember.findMany({
			where: { groupId: group.id },
			include: { user: true },
		});

		for (const member of members) {
			if (!member.user.stellarAddress) continue;

			let paid = false;
			try {
				paid = await hasContributed(
					onchainGroupId,
					member.user.stellarAddress,
					chainCycle,
				);
			} catch {
				continue;
			}

			if (!paid) continue;

			const existing = await prisma.contribution.findUnique({
				where: {
					groupId_userId_cycle: {
						groupId: group.id,
						userId: member.userId,
						cycle: chainCycle,
					},
				},
			});

			if (existing?.status === "confirmed") continue;

			await prisma.contribution.upsert({
				where: {
					groupId_userId_cycle: {
						groupId: group.id,
						userId: member.userId,
						cycle: chainCycle,
					},
				},
				create: {
					groupId: group.id,
					userId: member.userId,
					cycle: chainCycle,
					amount: group.contributionAmount,
					status: "confirmed",
					confirmedAt: new Date(),
				},
				update: { status: "confirmed", confirmedAt: new Date() },
			});

			contributionsConfirmed += 1;
		}
	}

	return { statusUpdated, contributionsConfirmed };
}

/**
 * Finalize pending transactions by reading the network's real result for their
 * hash. Flips pending → success/failed from the chain's own answer rather than
 * from what the client claimed happened.
 */
async function finalizePendingTransactions(): Promise<number> {
	const pending = await prisma.transaction.findMany({
		where: { status: "pending", stellarTxHash: { not: null } },
		take: 100,
	});

	let finalized = 0;

	for (const tx of pending) {
		try {
			const status = await getTransactionStatus(tx.stellarTxHash!);

			// NOT_FOUND means still pending or not yet visible — leave it.
			if (status !== "SUCCESS" && status !== "FAILED") continue;

			await prisma.transaction.update({
				where: { id: tx.id },
				data: { status: status === "SUCCESS" ? "success" : "failed" },
			});

			finalized += 1;
		} catch (error) {
			console.warn(`[indexer] tx ${tx.id} status check failed:`, error);
		}
	}

	return finalized;
}

/** Pool balance for a group, as a decimal string. Used by dashboard reads. */
export async function poolBalance(onchainGroupId: bigint): Promise<string> {
	return fromStroops(await getPool(onchainGroupId));
}
