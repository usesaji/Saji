/**
 * The Circle/Group page: group-level totals, the user's own progress toward the
 * target, a circle progress bar, the payout rotation, and cycle activity.
 *
 * Ported from `GroupController::circle`. All figures are the off-chain index of
 * on-chain state.
 */

import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { handle, json } from "@/server/http";
import { assertVisible, findGroupOr404 } from "@/server/groups";
import { fromStroops, toStroops } from "@/server/stellar/service";
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
					include: { user: { select: { id: true, name: true } } },
					orderBy: { payoutPosition: "asc" },
				}),
				prisma.transaction.findMany({
					where: { groupId: group.id },
					select: {
						id: true,
						type: true,
						status: true,
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
		// the member eventually receives: contribution × member count.
		const contribution = toStroops(group.contributionAmount.toString());
		const userAim = contribution * BigInt(Math.max(memberCount, 1));

		// Circle progress: a BLENDED figure across the full rotation, so the bar
		// moves smoothly instead of jumping a whole member's share at a time —
		// completed cycles, plus the fraction of the CURRENT cycle contributed
		// so far, over the total number of cycles (one payout per member).
		//
		// e.g. 2 members, cycle 0 paid out, 1 of 2 paid this cycle →
		// (1 + 0.5) / 2 = 75%. Completed cycles alone would read a coarse 50%.
		const totalCycles = Math.max(memberCount, 1);
		const completedCycles = Math.min(group.currentCycle, totalCycles);
		const currentCycleFraction =
			memberCount > 0 ? Math.min(1, paidThisCycle.size / memberCount) : 0;

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
			payout_rotation: rotation.map((member) => ({
				position: member.payoutPosition,
				user_id: member.userId,
				name: member.user.name,
				has_received_payout: member.hasReceivedPayout,
				removed: member.status === "removed",
			})),
			cycle_activity: cycleActivity,
		});
	});
}
