/**
 * The Circle/Group page: group-level totals, the user's own progress toward the
 * target, a circle progress bar, the payout rotation, and cycle activity.
 *
 * Ported from `GroupController::circle`. All figures are the off-chain index of
 * on-chain state.
 */

import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { HttpError, handle, json } from "@/server/http";
import {
	assertVisible,
	findGroupOr404,
	viewershipOf,
} from "@/server/groups";
import {
	fromStroops,
	nextRecipient,
	toStroops,
} from "@/server/stellar/service";
import { percentOf } from "@/server/challenges";

/** How many recent on-chain events the cycle-activity list shows. */
const ACTIVITY_LIMIT = 20;

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ groupId: string }> },
) {
	return handle(async () => {
		const user = await requireUser(request);
		const { groupId } = await params;

		const group = await findGroupOr404(groupId);
		await assertVisible(group, user.id);

		const viewership = await viewershipOf(group, user.id);

		/**
		 * A PENDING requester does not get the circle's financial interior.
		 *
		 * `isVisibleTo` admits `pending` so someone can see what they asked to
		 * join — reasonable on its own, but combined with an invite link that
		 * anyone can forward, it meant: hold the link → POST /join → instantly
		 * read every member's name and wallet address, the pool balance and the
		 * full contribution history. Approval gated PAYING IN, not seeing.
		 *
		 * They keep exactly what the join preview already showed them, which is
		 * what they need to decide, and nothing about who else is inside.
		 */
		if (viewership === "pending") {
			throw new HttpError(
				403,
				"Your request to join is still pending. You'll see the circle's activity once the organizer approves you.",
			);
		}

		/**
		 * "Contribute Privacy" (`hide_balances`) is now ENFORCED here.
		 *
		 * It was stored, serialised and rendered as a setting, but no circle
		 * endpoint read it — only the challenge summary did. A user could switch
		 * on a privacy control that changed nothing, which is worse than not
		 * offering it, because they may share on the strength of it.
		 *
		 * What it actually protects is each member's STELLAR ADDRESS. That field
		 * is not merely "their balance in this circle" — an address is a public
		 * key into a public ledger, so publishing it to the group exposes that
		 * person's entire external wallet: every asset they hold and every
		 * transaction they have ever made, circle-related or not. Explorer links
		 * on other members' activity reveal the same thing by another route.
		 *
		 * The organizer is exempt: they admit members on-chain by signing with
		 * those addresses, so hiding them would break the circle's operation.
		 */
		const maskAddresses =
			group.hideBalances && viewership !== "organizer";

		const [memberCount, confirmed, rotation, cycleActivity] =
			await Promise.all([
				prisma.groupMember.count({
					where: { groupId: group.id, status: "approved" },
				}),
				prisma.contribution.findMany({
					where: { groupId: group.id, status: "confirmed" },
					select: { userId: true, cycle: true, amount: true },
				}),
				// Members removed on-chain (defaulted) are FLAGGED, not hidden,
				// so the circle can see what happened. They carry no rotation
				// position.
				prisma.groupMember.findMany({
					where: { groupId: group.id, status: { in: ["approved", "removed"] } },
					include: {
						user: { select: { id: true, name: true, stellarAddress: true } },
					},
					orderBy: { payoutPosition: "asc" },
				}),
				prisma.transaction.findMany({
					where: { groupId: group.id },
					select: {
						id: true,
						type: true,
						status: true,
						// Needed to decide whose rows keep their explorer link when
						// the circle has privacy on.
						userId: true,
						stellarTxHash: true,
						explorerUrl: true,
						createdAt: true,
					},
					orderBy: { createdAt: "desc" },
					take: ACTIVITY_LIMIT,
				}),
			]);

		// Total deposited by the whole group.
		let totalDeposited = 0n;
		let userPaid = 0n;
		const paidThisCycle = new Set<string>();
		let youPaidThisCycle = false;

		for (const row of confirmed) {
			const amount = toStroops(row.amount.toString());
			totalDeposited += amount;

			if (row.userId === user.id) {
				userPaid += amount;
				if (row.cycle === group.currentCycle) youPaidThisCycle = true;
			}

			if (row.cycle === group.currentCycle) {
				paidThisCycle.add(row.userId.toString());
			}
		}

		// In a rotating circle the "aim" is one full payout — the pooled amount
		// the member eventually receives.
		//
		// That is contribution × (members - 1), NOT × members: the cycle's
		// recipient is exempt from funding their own pot, so only the others pay
		// in. Using the full member count overstated every member's target and
		// the payout figure shown on the circle screen by one contribution.
		// Who the contract will actually pay this cycle, mapped back to a user.
		// Done here so the rotation can be labelled without publishing every
		// member's wallet address to every other member.
		let currentRecipientUserId: bigint | null = null;
		if (group.onchainGroupId !== null) {
			try {
				const address = await nextRecipient(group.onchainGroupId);
				if (address) {
					currentRecipientUserId =
						rotation.find((m) => m.user.stellarAddress === address)?.userId ??
						null;
				}
			} catch {
				// RPC unavailable — the client falls back to its own live read.
			}
		}

		const contribution = toStroops(group.contributionAmount.toString());
		const payers = Math.max(memberCount - 1, 1);
		const userAim = contribution * BigInt(payers);

		// Circle progress: a BLENDED figure across the full rotation, so the bar
		// moves smoothly instead of jumping a whole member's share at a time —
		// completed cycles, plus the fraction of the CURRENT cycle contributed
		// so far, over the total number of cycles (one payout per member).
		//
		// e.g. 3 members, cycle 0 paid out, 1 of the 2 who owe has paid →
		// (1 + 0.5) / 3 = 50%. Completed cycles alone would read a coarse 33%.
		//
		// The denominator for the in-flight cycle is `payers`, not the member
		// count — the recipient owes nothing, so the bar could never reach a
		// full cycle otherwise.
		const totalCycles = Math.max(memberCount, 1);
		const completedCycles = Math.min(group.currentCycle, totalCycles);
		const currentCycleFraction = Math.min(1, paidThisCycle.size / payers);

		// Don't let the in-progress cycle push past 100% once the rotation is
		// complete — there is no "current cycle" left to fill.
		const rawProgress =
			completedCycles >= totalCycles
				? totalCycles
				: completedCycles + currentCycleFraction;

		const circleProgressPct =
			Math.round((rawProgress / totalCycles) * 100 * 100) / 100;

		return json({
			group: {
				id: group.id,
				name: group.name,
				status: group.status,
				asset_code: group.assetCode,
				contribution_amount: group.contributionAmount,
				contribution_frequency: group.contributionFrequency,
				target_amount: group.targetAmount,
				contract_address: group.contractAddress,
			},
			member_count: memberCount,
			current_cycle: group.currentCycle,
			total_deposited: fromStroops(totalDeposited),
			// Has the viewer already paid the CURRENT cycle? Drives the "you've
			// paid this cycle" button state, distinct from lifetime progress.
			you_paid_this_cycle: youPaidThisCycle,
			user_progress: {
				paid: fromStroops(userPaid),
				aim: fromStroops(userAim),
				percent: percentOf(userPaid, userAim),
			},
			circle_progress: {
				cycles_done: completedCycles,
				cycles_total: totalCycles,
				percent: circleProgressPct,
			},
			// Resolved SERVER-side from the contract so the UI can name this
			// cycle's recipient without every member's address being published to
			// every other member — which is what `hide_balances` exists to stop.
			// Best-effort: null falls the client back to its own chain read.
			current_recipient_user_id: currentRecipientUserId,
			payout_rotation: rotation.map((member) => ({
				position: member.payoutPosition,
				user_id: member.userId,
				name: member.user.name,
				// Your own address is always yours to see; others' are masked when
				// the circle has privacy on.
				stellar_address:
					maskAddresses && member.userId !== user.id
						? null
						: member.user.stellarAddress,
				has_received_payout: member.hasReceivedPayout,
				removed: member.status === "removed",
			})),
			// Hand-mapped rather than serializeTransaction: this is a partial
			// `select`, not a full Transaction row, so the full serializer's
			// field set wouldn't line up. Same snake_case requirement applies —
			// the frontend reads `a.created_at`/`a.explorer_url` on this list.
			cycle_activity: cycleActivity.map((tx) => ({
				id: tx.id,
				type: tx.type,
				status: tx.status,
				// An explorer link is an address by another route: following one
				// reveals the participant's wallet and its whole history. Kept for
				// your own rows so you can still verify your own money.
				stellar_tx_hash:
					maskAddresses && tx.userId !== user.id ? null : tx.stellarTxHash,
				explorer_url:
					maskAddresses && tx.userId !== user.id ? null : tx.explorerUrl,
				created_at: tx.createdAt,
			})),
		});
	});
}
