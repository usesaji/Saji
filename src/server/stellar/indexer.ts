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

import { prisma, withTransaction } from "../db";
import {
	claimableOf,
	explorerUrl,
	fromStroops,
	getGroup,
	getMembers,
	getPool,
	getTransactionStatus,
	hasContributed,
	nextRecipient,
	triggerPayout,
} from "./service";
import type { OnchainGroup } from "./service";
import { reconcileChallengeDeposits } from "../challenges";

/** Contract Status enum → our DB status string. */
const STATUS_MAP = ["draft", "open", "active", "completed"] as const;

export interface IndexSummary {
	groups_checked: number;
	status_updated: number;
	contributions_confirmed: number;
	payouts_triggered: number;
	challenge_deposits_confirmed: number;
	txns_finalized: number;
	errors: number;
}

/**
 * Reconcile every group that is live on-chain, or just one when `groupId` is
 * given (the targeted fast path used right after a user action).
 *
 * `waitForPayouts` controls whether a triggered payout blocks for on-ledger
 * confirmation (see `waitForTransaction`, up to ~9s) before this returns.
 * Defaults to true for the cron sweep, where that cost is invisible to any
 * user. Callers on a user-facing request path (contribute/activate) that
 * need this to stay fast should pass `false` — the payout attempt still
 * happens, it just isn't awaited for confirmation here; the cron sweep or a
 * `reconcileAfterResponse` background call picks up the result shortly after.
 */
export async function runIndexer(
	groupId?: bigint,
	waitForPayouts = true,
): Promise<IndexSummary> {
	const summary: IndexSummary = {
		groups_checked: 0,
		status_updated: 0,
		contributions_confirmed: 0,
		payouts_triggered: 0,
		challenge_deposits_confirmed: 0,
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
			const result = await reconcileGroup(
				group.id,
				group.onchainGroupId!,
				waitForPayouts,
			);
			summary.status_updated += result.statusUpdated;
			summary.contributions_confirmed += result.contributionsConfirmed;
			summary.payouts_triggered += result.payoutsTriggered;
		} catch (error) {
			// GroupNotFound (Error #1) means the recorded on-chain id has no
			// matching contract group — a stale record, not an indexer failure.
			// Skip it quietly rather than counting an error.
			if (String(error).includes("Error(Contract, #1)")) continue;

			summary.errors += 1;
			console.warn(`[indexer] group ${group.id} failed:`, error);
		}
	}

	// Challenge circles have no on-chain group id (they use the separate
	// challenge contract, addressed by the DB group id directly), so they
	// never appear in the query above. Sweep any that have pending deposits
	// waiting to be checked against the challenge contract's own balance.
	const challengeGroupIds = await prisma.challengeDeposit
		.findMany({
			where: {
				status: "pending",
				...(groupId !== undefined && { groupId }),
			},
			select: { groupId: true },
			distinct: ["groupId"],
		})
		.then((rows) => rows.map((r) => r.groupId));

	for (const challengeGroupId of challengeGroupIds) {
		try {
			summary.challenge_deposits_confirmed +=
				await reconcileChallengeDeposits(challengeGroupId);
		} catch (error) {
			summary.errors += 1;
			console.warn(`[indexer] challenge ${challengeGroupId} failed:`, error);
		}
	}

	summary.txns_finalized = await finalizePendingTransactions();

	return summary;
}

async function reconcileGroup(
	dbGroupId: bigint,
	onchainGroupId: bigint,
	waitForPayouts: boolean,
): Promise<{
	statusUpdated: number;
	contributionsConfirmed: number;
	payoutsTriggered: number;
}> {
	const state: OnchainGroup = await getGroup(onchainGroupId);

	let statusUpdated = 0;
	let contributionsConfirmed = 0;

	const group = await prisma.group.findUnique({ where: { id: dbGroupId } });
	if (!group) return { statusUpdated, contributionsConfirmed, payoutsTriggered: 0 };

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
	//
	// Cycle 0 is a real, active cycle — `start_cycle` sets Cycle=0 and Status=
	// Active in the same call — so this must NOT require chainCycle > 0. That
	// guard would silently skip confirming every group's first cycle.
	//
	// Fetched once here and reused below for the payout-loop bound, rather
	// than a second `groupMember.count` query for the same group.
	let memberCount = 0;
	if (chainStatus === "active") {
		const members = await prisma.groupMember.findMany({
			where: { groupId: group.id },
			include: { user: true },
		});
		memberCount = members.length;

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

	// --- Payout for a completed cycle --------------------------------------
	// `trigger_payout` is what "earmarks" a completed cycle's pool for its
	// recipient — nothing pays out until this is called. It is safe to attempt
	// speculatively on every reconcile pass: the contract itself is the
	// completeness check and reverts with NotAllContributed / WrongStatus (a
	// no-op here, not an error) when the cycle isn't actually ready. This is
	// what makes the rotating-circle payout happen at all, since nothing else
	// in the app calls it.
	let payoutsTriggered = 0;
	if (chainStatus === "active") {
		payoutsTriggered = await triggerPayoutIfReady(
			group.id,
			onchainGroupId,
			chainCycle,
			memberCount,
			waitForPayouts,
		);
	}

	return { statusUpdated, contributionsConfirmed, payoutsTriggered };
}

/**
 * Poll until a just-submitted transaction is actually applied on-ledger, or
 * give up. `sendTransaction` only confirms the network ACCEPTED it for
 * processing (`PENDING`) — it says nothing about the resulting state, which
 * is exactly what callers reading `claimable_of` right after need to be true.
 */
async function waitForTransaction(
	hash: string,
	attempts = 6,
	delayMs = 1500,
): Promise<boolean> {
	for (let i = 0; i < attempts; i++) {
		const status = await getTransactionStatus(hash);
		if (status === "SUCCESS") return true;
		if (status === "FAILED") return false;
		await new Promise((resolve) => setTimeout(resolve, delayMs));
	}
	return false;
}

/**
 * Attempt `trigger_payout` for a group, once per cycle that is actually
 * ready, and mirror a successful payout into the DB (Payout row, a
 * Transaction for the activity feed, and `hasReceivedPayout` on the member).
 *
 * Loops rather than firing once: if the cron sweep lagged (RPC outage, cold
 * start) more than one cycle can be genuinely complete by the time this runs,
 * and `trigger_payout` only ever settles one cycle per call. The loop is
 * bounded by member count, since a group can have at most that many payouts
 * before every recipient has been paid and `next_recipient` returns null.
 *
 * Never throws: an unready cycle (NotAllContributed / WrongStatus) is the
 * expected common case, not a failure, and is swallowed the same way the
 * rest of this indexer swallows GroupNotFound.
 *
 * `wait = false` skips this entirely rather than firing-without-confirming:
 * a triggered-but-unrecorded payout that the process gets torn down before
 * recording (a real risk on serverless, right after a response is sent)
 * would be worse than just leaving it for the next sweep — the daily cron
 * sweep and `reconcileAfterResponse` already schedule a background
 * pass right after the same actions that call this inline.
 */
async function triggerPayoutIfReady(
	dbGroupId: bigint,
	onchainGroupId: bigint,
	startCycle: number,
	memberCount: number,
	wait: boolean,
): Promise<number> {
	if (!wait) return 0;

	let triggered = 0;
	const maxAttempts = Math.max(memberCount, 1);
	let cycle = startCycle;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		const recipientAddress = await nextRecipient(onchainGroupId);
		if (!recipientAddress) break; // Nobody left awaiting payout this round.

		const [grossBefore, claimableBefore] = await Promise.all([
			getPool(onchainGroupId),
			claimableOf(onchainGroupId, recipientAddress),
		]);

		let hash: string;
		try {
			hash = await triggerPayout(onchainGroupId);
		} catch (error) {
			// NotAllContributed (#9) / WrongStatus (#5): the cycle genuinely isn't
			// complete yet, or the group already finished. Both are the expected
			// steady state on most reconcile passes, not an indexer error.
			if (
				String(error).includes("Error(Contract, #9)") ||
				String(error).includes("Error(Contract, #5)")
			) {
				break;
			}
			throw error;
		}

		// sendTransaction only confirms SUBMISSION, not ledger application —
		// reading claimable_of right away can still see the PRE-payout value,
		// which would record a real payout as netAmount 0 / feeAmount = the
		// whole pool. Wait for the network's own answer first.
		const settled = await waitForTransaction(hash);
		const paidCycle = cycle;
		cycle += 1; // trigger_payout always advances the cycle by exactly one.

		if (!settled) {
			// Still not resolved after the poll budget — leave it. The next
			// sweep re-derives readiness from next_recipient/claimable_of, so
			// this attempt is simply retried rather than recorded wrong.
			console.warn(
				`[indexer] trigger_payout ${hash} for group ${dbGroupId} did not confirm in time`,
			);
			break;
		}

		const claimableAfter = await claimableOf(onchainGroupId, recipientAddress);
		const netAmount = claimableAfter - claimableBefore;

		const recipient = await prisma.user.findUnique({
			where: { stellarAddress: recipientAddress },
		});

		// A recipient with no linked user shouldn't happen (they had to hold a
		// linked wallet to contribute), but the on-chain payout already
		// happened either way — skip the DB mirror rather than lose the loop.
		if (recipient) {
			await withTransaction(async (tx) => {
				const payout = await tx.payout.upsert({
					where: { groupId_cycle: { groupId: dbGroupId, cycle: paidCycle } },
					create: {
						groupId: dbGroupId,
						recipientId: recipient.id,
						cycle: paidCycle,
						grossAmount: fromStroops(grossBefore),
						feeAmount: fromStroops(grossBefore - netAmount),
						netAmount: fromStroops(netAmount),
						status: "confirmed",
						stellarTxHash: hash,
						confirmedAt: new Date(),
					},
					update: {},
				});

				await tx.transaction.upsert({
					where: { stellarTxHash: hash },
					create: {
						groupId: dbGroupId,
						userId: recipient.id,
						type: "payout",
						subjectType: "Payout",
						subjectId: payout.id,
						stellarTxHash: hash,
						status: "success",
						explorerUrl: explorerUrl(hash),
					},
					update: {},
				});

				await tx.groupMember.updateMany({
					where: { groupId: dbGroupId, userId: recipient.id },
					data: { hasReceivedPayout: true },
				});
			});
		}

		triggered += 1;
	}

	return triggered;
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
