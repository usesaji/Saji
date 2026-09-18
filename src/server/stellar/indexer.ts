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
import { emit, type NotifyInput } from "../notifications";
import {
	explorerUrl,
	fromStroops,
	getCycle,
	depositsOpenAt,
	getGroup,
	getMembers,
	getPayoutEvent,
	getPool,
	getTransactionStatus,
	hasContributed,
	isRemoved,
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
	/**
	 * Contract reads that threw and were skipped rather than aborting the sweep.
	 *
	 * Separate from `errors` because these are individually recoverable — the
	 * next pass re-reads the same state — but collectively they are the signal
	 * that something is systematically wrong. This indexer swallows failure
	 * everywhere by design, which means without a count of what was swallowed a
	 * totally broken reconciler and an idle one emit the identical summary.
	 * ANY sustained nonzero value here should alert: in steady state it is 0.
	 */
	read_failures: number;
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
		read_failures: 0,
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
			summary.read_failures += result.readFailures;
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

	// Scoped to the same group as the rest of the pass. Unscoped, this walked up
	// to 100 pending transactions from ANY group with one sequential RPC call
	// each — so every user action that scheduled a "targeted" reconcile actually
	// dragged the whole global backlog through the network, and the cost grew
	// with a backlog the caller had nothing to do with. The daily sweep still
	// passes no group id and so still finalizes everything.
	summary.txns_finalized = await finalizePendingTransactions(groupId);

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
	readFailures: number;
}> {
	const state: OnchainGroup = await getGroup(onchainGroupId);

	let statusUpdated = 0;
	let contributionsConfirmed = 0;
	let readFailures = 0;

	// Notifications for whatever this pass discovers had COMPLETED on-chain.
	//
	// Collected and flushed at the end rather than emitted inline, for two
	// reasons. They must not run inside the `withTransaction` below — an email
	// round trip would hold a database transaction open across the network. And
	// this function is itself already called from `after()` (via
	// `reconcileAfterResponse`) or from the cron route, so there is no second
	// response to defer behind; awaiting them here is the deferral.
	//
	// Every entry is keyed on the domain row it describes, never on this pass,
	// so the repeated reconciles that re-observe the same event collapse to one
	// notification. See `emit()`.
	const notify: NotifyInput[] = [];

	const group = await prisma.group.findUnique({ where: { id: dbGroupId } });
	if (!group) {
		return {
			statusUpdated,
			contributionsConfirmed,
			payoutsTriggered: 0,
			readFailures,
		};
	}

	// --- Status and cycle -------------------------------------------------
	// The cycle is NOT on the group struct — it lives under its own storage key
	// and needs its own read. This previously did `state.current_cycle ?? 0`
	// against a field that does not exist, which pinned every group to cycle 0:
	// contributions were only ever reconciled for cycle 0, and the payout upsert
	// (keyed on groupId+cycle) no-opped for every cycle after the first.
	const chainStatus = STATUS_MAP[state.status] ?? "open";
	const chainCycle = await getCycle(onchainGroupId);

	// WHEN THIS CYCLE IS DUE. `next_payout_at` was read in three places (the
	// group cards, the group dashboard, and the "contribution due" prompt on the
	// withdraw screen) but written by NOTHING, so it was permanently null: every
	// card showed "Next Payout —" and no contribution could ever read as
	// overdue. The contract knows the answer — `CycleStart` plus the cycle
	// length — so derive it here, where chain state is already being read.
	//
	// Best-effort: a failed read leaves the stored value alone rather than
	// blanking a date the UI is showing.
	let nextPayoutAt: Date | null = null;
	if (chainStatus === "active") {
		try {
			const opensAt = await depositsOpenAt(onchainGroupId);
			if (opensAt > 0) {
				nextPayoutAt = new Date((opensAt + group.cycleLengthSeconds) * 1000);
			}
		} catch (error) {
			readFailures += 1;
			console.warn(
				`[indexer] deposits_open_at read failed for group ${group.id}:`,
				error,
			);
		}
	}

	const dueChanged =
		nextPayoutAt !== null &&
		group.nextPayoutAt?.getTime() !== nextPayoutAt.getTime();

	if (
		group.status !== chainStatus ||
		group.currentCycle !== chainCycle ||
		dueChanged
	) {
		await prisma.group.update({
			where: { id: group.id },
			data: {
				status: chainStatus,
				currentCycle: chainCycle,
				...(nextPayoutAt !== null && { nextPayoutAt }),
			},
		});
		statusUpdated = 1;
	}

	// --- Members ----------------------------------------------------------
	// Map on-chain addresses back to users so a wallet that joined outside the
	// app still shows up as a member. Addresses with no linked user are
	// skipped, not invented.
	// `GroupConfig` carries only `member_count`, never the roster, so there is no
	// struct field to fall back to — a failed read means we must leave membership
	// alone this pass rather than guess at it.
	let memberAddresses: string[] = [];
	let rosterRead = true;
	try {
		memberAddresses = await getMembers(onchainGroupId);
	} catch (error) {
		rosterRead = false;
		readFailures += 1;
		console.warn(
			`[indexer] get_members read failed for group ${group.id}:`,
			error,
		);
	}

	if (rosterRead) {
		// One query instead of one findUnique per address.
		const users = await prisma.user.findMany({
			where: { stellarAddress: { in: memberAddresses } },
			select: { id: true, stellarAddress: true },
		});
		const userByAddress = new Map(
			users.map((u) => [u.stellarAddress as string, u.id]),
		);

		for (const [index, address] of memberAddresses.entries()) {
			const userId = userByAddress.get(address);
			if (userId === undefined) continue;

			// The chain's own view of whether this member was defaulted out.
			// `is_removed` was exported but never called, so a member removed
			// on-chain stayed `approved` in the DB forever: they kept counting
			// toward member_count and the payout rotation, and the "removed" UI
			// state could never render.
			let removed = false;
			try {
				removed = await isRemoved(onchainGroupId, address);
			} catch (error) {
				readFailures += 1;
				console.warn(
					`[indexer] is_removed read failed for group ${group.id}, ${address}:`,
					error,
				);
				// Unknown ≠ removed. Skip this member rather than downgrade them
				// on the strength of a failed read.
				continue;
			}

			// MUST be "approved", not "active". `MemberStatus` has an `active`
			// value that NOTHING in the app accepts: assertApprovedMember and
			// isVisibleTo both test for `approved`, so writing `active` here
			// 403'd every on-chain member out of their own circle — they could
			// not contribute, could not view it, and it vanished from their
			// dashboard and claimable balances.
			const status = removed ? ("removed" as const) : ("approved" as const);

			await prisma.groupMember.upsert({
				where: { groupId_userId: { groupId: group.id, userId } },
				create: {
					groupId: group.id,
					userId,
					status,
					payoutPosition: index + 1,
					joinedAt: new Date(),
				},
				update: { status, payoutPosition: index + 1 },
			});
		}

		// WHO HAS ALREADY BEEN PAID, taken from the chain rather than from our
		// own record of having paid them.
		//
		// `hasReceivedPayout` was only ever set by `triggerPayoutIfReady` — i.e.
		// only when THIS indexer was the thing that called `trigger_payout`. But
		// that function is permissionless and can settle a cycle by any route: an
		// earlier pass that fired it and was torn down before recording, a manual
		// invoke, anyone at all. A payout that landed any other way was invisible
		// to the DB forever, so the recipient stayed `hasReceivedPayout: false`,
		// the circle page kept naming them as the next recipient, and the
		// rotation display disagreed with the contract permanently.
		//
		// `next_recipient` is the contract's own scan for the first active member
		// who has NOT received. Everyone before them in rotation order therefore
		// has — which recovers the flag without inventing any money figure.
		if (chainStatus === "active" || chainStatus === "completed") {
			try {
				const awaiting = await nextRecipient(onchainGroupId);
				// null ⇒ nobody is awaiting a payout, so every member has received.
				const cutoff =
					awaiting === null
						? memberAddresses.length
						: memberAddresses.indexOf(awaiting);

				if (cutoff > 0) {
					const paidAddresses = memberAddresses.slice(0, cutoff);
					const paidUserIds = paidAddresses
						.map((a) => userByAddress.get(a))
						.filter((id): id is bigint => id !== undefined);

					if (paidUserIds.length > 0) {
						await prisma.groupMember.updateMany({
							where: {
								groupId: group.id,
								userId: { in: paidUserIds },
								hasReceivedPayout: false,
							},
							data: { hasReceivedPayout: true },
						});
					}
				}
			} catch (error) {
				readFailures += 1;
				console.warn(
					`[indexer] next_recipient read failed for group ${group.id}:`,
					error,
				);
			}
		}
	}

	// --- Contributions, every cycle 0..current -----------------------------
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

		// Confirm across EVERY cycle 0..current, not just the current one. A
		// cycle can complete, pay out and advance between two sweeps, and a
		// payment made for an earlier cycle would otherwise be stranded as
		// `pending` forever — excluded from pool balances, total_deposited and
		// saved_balance, so the user's money silently under-reports. The daily
		// cron makes that window 24h wide. (Laravel's indexer did this; the port
		// dropped it.)
		//
		// Bounded work: cycles already fully confirmed in the DB are skipped
		// without any RPC call, so steady state costs exactly the current cycle.
		const confirmedByCycle = new Map<number, Set<bigint>>();
		for (const row of await prisma.contribution.findMany({
			where: { groupId: group.id, status: "confirmed" },
			select: { cycle: true, userId: true },
		})) {
			let set = confirmedByCycle.get(row.cycle);
			if (!set) confirmedByCycle.set(row.cycle, (set = new Set()));
			set.add(row.userId);
		}

		for (let cycle = 0; cycle <= chainCycle; cycle += 1) {
			for (const member of members) {
				if (!member.user.stellarAddress) continue;
				if (confirmedByCycle.get(cycle)?.has(member.userId)) continue;

				let paid = false;
				try {
					paid = await hasContributed(
						onchainGroupId,
						cycle,
						member.user.stellarAddress,
					);
				} catch (error) {
					// A read that fails is NOT "this member hasn't paid" — it is an
					// absence of information, so skipping is right. But it must be
					// counted: a systematically broken read (wrong argument order, RPC
					// down, contract redeployed) fails here on every member of every
					// group, and before this counter existed the sweep still reported
					// `errors: 0` and looked perfectly healthy.
					readFailures += 1;
					console.warn(
						`[indexer] has_contributed read failed for group ${group.id}, member ${member.userId}:`,
						error,
					);
					continue;
				}

				if (!paid) continue;

				// The pre-read that used to sit here was redundant with the upsert
				// below and with the confirmedByCycle skip above.
				//
				// The confirmation and its activity row are written in ONE
				// transaction so the feed can never disagree with the money.
				await withTransaction(async (tx) => {
					const contribution = await tx.contribution.upsert({
						where: {
							groupId_userId_cycle: {
								groupId: group.id,
								userId: member.userId,
								cycle,
							},
						},
						create: {
							groupId: group.id,
							userId: member.userId,
							cycle,
							amount: group.contributionAmount,
							status: "confirmed",
							confirmedAt: new Date(),
						},
						update: { status: "confirmed", confirmedAt: new Date() },
					});

					// THIS is what puts a contribution in the activity feed at all.
					// Contributions used to write only a `Contribution` row, so the
					// single most common action in the product never appeared in
					// Activity, the "Contributions" filter tab was permanently empty,
					// and the contribution branch of `resolveSubjectAmounts` was dead
					// code waiting for a row that was never written.
					//
					// No `stellarTxHash` on purpose. This is derived from the
					// contract's `has_contributed` flag, which says THAT a member paid
					// this cycle, not which transaction did it — the indexer never
					// sees that hash. Recording a borrowed or invented one would be
					// worse than recording none, and its absence also keeps the row
					// away from `finalizePendingTransactions` (which requires a hash),
					// so nothing can later flip a confirmed contribution to failed.
					//
					// Dedupe is a read-then-write on the indexed (subjectType,
					// subjectId) pair. Two genuinely concurrent reconcile passes could
					// both miss and insert twice; the `confirmedByCycle` skip above
					// makes that rare, since only the unconfirmed→confirmed transition
					// reaches here, and a duplicate is COSMETIC — an extra feed row,
					// never money. The durable fix is a
					// `@@unique([subjectType, subjectId])` migration, after which this
					// collapses into an upsert.
					const logged = await tx.transaction.findFirst({
						where: {
							subjectType: "Contribution",
							subjectId: contribution.id,
						},
						select: { id: true },
					});

					if (!logged) {
						await tx.transaction.create({
							data: {
								groupId: group.id,
								userId: member.userId,
								type: "contribution",
								subjectType: "Contribution",
								subjectId: contribution.id,
								// The chain already confirmed it — that is the whole
								// precondition for reaching this branch.
								status: "success",
							},
						});
					}

					notify.push({
						userId: member.userId,
						type: "contribution_confirmed",
						// Keyed on the contribution, so the many reconcile passes that
						// re-observe this same payment collapse to one notification.
						dedupeKey: `contribution:${contribution.id}`,
						title: `Contribution confirmed — ${group.name}`,
						body: `Your ${group.contributionAmount} ${group.assetCode} contribution to "${group.name}" is confirmed on-chain.`,
						href: `/groups/${group.id}/circle`,
						meta: {
							group_id: String(group.id),
							group_name: group.name,
							amount: group.contributionAmount.toString(),
							asset_code: group.assetCode,
							cycle,
						},
					});
				});

				contributionsConfirmed += 1;
			}
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
			memberCount,
			waitForPayouts,
			notify,
		);
	}

	// Flush. `emit()` never throws, so a mail outage cannot break a reconcile
	// pass — and because every key is deterministic, anything that did fail to
	// record is simply re-raised by the next pass.
	for (const one of notify) {
		await emit(one);
	}

	return {
		statusUpdated,
		contributionsConfirmed,
		payoutsTriggered,
		readFailures,
	};
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
	memberCount: number,
	wait: boolean,
	notify: NotifyInput[],
): Promise<number> {
	if (!wait) return 0;

	let triggered = 0;
	const maxAttempts = Math.max(memberCount, 1);

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		const recipientAddress = await nextRecipient(onchainGroupId);
		if (!recipientAddress) break; // Nobody left awaiting payout this round.

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

		if (!settled) {
			// Still not resolved after the poll budget — leave it. The next
			// sweep re-derives readiness from next_recipient/claimable_of, so
			// this attempt is simply retried rather than recorded wrong.
			console.warn(
				`[indexer] trigger_payout ${hash} for group ${dbGroupId} did not confirm in time`,
			);
			break;
		}

		// Take the figures from the payout's OWN event rather than from a
		// before/after diff of `get_pool` + `claimable_of`. The diff was racy:
		// nothing serialises reconcile passes, so a second pass could capture
		// its "before" reads, watch this pass's payout land, and then compute
		// gross/fee against a pool another pass had already consumed — writing a
		// confirmed Payout row with wrong money figures that nothing revisits.
		// The event is emitted inside the payout, so it describes exactly this
		// settlement and there is no earlier state to race against.
		const settledEvent = await getPayoutEvent(hash);
		if (!settledEvent) {
			// Applied, but we cannot read what it settled — recording guessed
			// figures is worse than leaving it. `next_recipient` and the cycle
			// have both moved on, so the next sweep re-derives from chain.
			console.warn(
				`[indexer] payout ${hash} for group ${dbGroupId} confirmed but emitted no readable payout event`,
			);
			break;
		}

		const netAmount = settledEvent.net;

		const recipient = await prisma.user.findUnique({
			where: { stellarAddress: recipientAddress },
		});

		// A recipient with no linked user shouldn't happen (they had to hold a
		// linked wallet to contribute), but the on-chain payout already
		// happened either way — skip the DB mirror rather than lose the loop.
		if (recipient) {
			await withTransaction(async (tx) => {
				const payout = await tx.payout.upsert({
					// The event's own cycle, not a locally incremented counter —
					// under concurrency the local one can drift from what this
					// transaction actually settled.
					where: {
						groupId_cycle: { groupId: dbGroupId, cycle: settledEvent.cycle },
					},
					create: {
						groupId: dbGroupId,
						recipientId: recipient.id,
						cycle: settledEvent.cycle,
						grossAmount: fromStroops(settledEvent.gross),
						feeAmount: fromStroops(settledEvent.fee),
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

				// THE notification this whole feature exists for. A payout settles
				// the moment the last member pays — which can be at any hour, with
				// the recipient nowhere near the app — and it does not reach their
				// wallet on its own: it sits as a claimable balance until they come
				// and claim it. Until now nothing told them it was there.
				//
				// Keyed on the Payout row (unique per group+cycle), so the repeated
				// reconciles that re-observe this settlement notify exactly once.
				notify.push({
					userId: recipient.id,
					type: "payout_received",
					dedupeKey: `payout:${payout.id}`,
					title: "Your circle payout is ready",
					body: `It's your turn — ${fromStroops(netAmount)} is waiting for you. It stays safely escrowed until you withdraw it, so there's no rush.`,
					href: "/wallet/withdraw",
					meta: {
						group_id: String(dbGroupId),
						payout_id: String(payout.id),
						amount: fromStroops(netAmount),
						cycle: settledEvent.cycle,
					},
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
async function finalizePendingTransactions(groupId?: bigint): Promise<number> {
	const pending = await prisma.transaction.findMany({
		where: {
			status: "pending",
			stellarTxHash: { not: null },
			...(groupId !== undefined && { groupId }),
		},
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
