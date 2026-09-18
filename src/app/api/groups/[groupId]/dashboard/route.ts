/**
 * Aggregated, read-optimized view of a group's health.
 *
 * Ported from `DashboardController::show`.
 *
 * Balances here are the off-chain INDEX. The response also returns the contract
 * address so the frontend can link to on-chain verification — the chain remains
 * the source of truth.
 */

import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { HttpError, handle, json } from "@/server/http";
import {
	assertVisible,
	findGroupOr404,
	viewershipOf,
} from "@/server/groups";
import { fromStroops, toStroops } from "@/server/stellar/service";

/** How many recent on-chain events to show. */
const ACTIVITY_LIMIT = 10;

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ groupId: string }> },
) {
	return handle(async () => {
		const user = await requireUser(request);
		const { groupId } = await params;

		const group = await findGroupOr404(groupId);

		// Pool balance, next recipient, and contribution progress are private
		// to the circle — gate on membership, not just authentication.
		await assertVisible(group, user.id);

		// Same reasoning as the circle route: a pending requester may see that
		// the circle exists and what its rules are, not its money.
		if ((await viewershipOf(group, user.id)) === "pending") {
			throw new HttpError(
				403,
				"Your request to join is still pending. You'll see the circle's activity once the organizer approves you.",
			);
		}

		const [memberCount, contributions, payouts, recentActivity] =
			await Promise.all([
				prisma.groupMember.count({
					where: { groupId: group.id, status: "approved" },
				}),
				prisma.contribution.findMany({
					where: { groupId: group.id, status: "confirmed" },
					select: { amount: true, cycle: true },
				}),
				prisma.payout.findMany({
					where: { groupId: group.id, status: "confirmed" },
					select: { netAmount: true, feeAmount: true },
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

		// Pool = confirmed contributions not yet paid out, net of fees. Mirror
		// of the on-chain balance.
		let pool = 0n;
		let confirmedThisCycle = 0;

		for (const row of contributions) {
			pool += toStroops(row.amount.toString());
			if (row.cycle === group.currentCycle) confirmedThisCycle += 1;
		}

		for (const row of payouts) {
			pool -= toStroops(row.netAmount.toString());
			pool -= toStroops(row.feeAmount.toString());
		}

		return json({
			group: {
				id: group.id,
				name: group.name,
				status: group.status,
				asset_code: group.assetCode,
				contribution_amount: group.contributionAmount,
				contract_address: group.contractAddress,
			},
			member_count: memberCount,
			current_cycle: group.currentCycle,
			pool_balance: fromStroops(pool),
			next_recipient_id: group.nextRecipientId,
			next_payout_at: group.nextPayoutAt,
			contribution_progress: {
				confirmed: confirmedThisCycle,
				total_members: memberCount,
			},
			recent_activity: recentActivity,
		});
	});
}
