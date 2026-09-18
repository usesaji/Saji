/**
 * The user's HOME dashboard.
 *
 * Ported from `UserDashboardController::show`.
 *
 * Every figure here is the off-chain INDEX mirrored from Soroban. The chain is
 * the source of truth; these are read-optimized aggregates for a fast render.
 */

import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { handle, json } from "@/server/http";
import { fromStroops, toStroops } from "@/server/stellar/service";
import type { Prisma } from "@prisma/client";

/** How many circle cards the dashboard shows before "view all". */
const CIRCLE_CARD_LIMIT = 5;

/**
 * Money still in play per asset: confirmed contributions less confirmed
 * payouts, grouped by the circle's asset. Largest first, zero/negative dropped.
 *
 * Grouped PER ASSET deliberately. A circle saves in exactly one token, so a
 * user in three circles can hold three currencies. Summing them would add
 * unrelated units, and subtracting a USDT payout from an XLM contribution can
 * even go negative.
 *
 * Neither contributions nor payouts store an asset — a circle saves in one
 * token, so the asset lives on the parent group and both sides read it there.
 */
async function savedPerAsset(
	userId: bigint,
): Promise<{ asset_code: string; saved: string }[]> {
	const [contributions, payouts] = await Promise.all([
		prisma.contribution.findMany({
			where: { userId, status: "confirmed" },
			select: { amount: true, group: { select: { assetCode: true } } },
		}),
		prisma.payout.findMany({
			where: { recipientId: userId, status: "confirmed" },
			select: { netAmount: true, group: { select: { assetCode: true } } },
		}),
	]);

	const net = new Map<string, bigint>();

	for (const row of contributions) {
		const code = row.group.assetCode;
		net.set(code, (net.get(code) ?? 0n) + toStroops(row.amount.toString()));
	}

	for (const row of payouts) {
		const code = row.group.assetCode;
		net.set(code, (net.get(code) ?? 0n) - toStroops(row.netAmount.toString()));
	}

	return [...net.entries()]
		// A fully-rotated circle nets to zero; neither that nor a negative is
		// worth a row on the dashboard.
		.filter(([, amount]) => amount > 0n)
		.sort(([, a], [, b]) => (b > a ? 1 : b < a ? -1 : 0))
		.map(([code, amount]) => ({
			asset_code: code,
			saved: fromStroops(amount),
		}));
}

export async function GET(request: Request) {
	return handle(async () => {
		const user = await requireUser(request);

		// Circles the user belongs to as an APPROVED member.
		const memberships = await prisma.groupMember.findMany({
			where: { userId: user.id, status: "approved" },
			select: { groupId: true },
		});

		const groupIds = memberships.map((m) => m.groupId);

		const assets = await savedPerAsset(user.id);

		// Headline = the asset the user has most in play. Falls back to USDC
		// (the default circle currency) when there is nothing saved at all.
		const headline = assets[0] ?? {
			asset_code: "USDC",
			saved: "0.0000000",
		};

		const liveWhere: Prisma.GroupWhereInput = {
			id: { in: groupIds },
			status: { in: ["open", "active"] },
		};

		const [circles, circlesTotal, people] = await Promise.all([
			prisma.group.findMany({
				where: liveWhere,
				include: {
					_count: { select: { members: { where: { status: "approved" } } } },
				},
				orderBy: { createdAt: "desc" },
				take: CIRCLE_CARD_LIMIT,
			}),
			prisma.group.count({ where: liveWhere }),
			// Distinct people the user saves with across ALL their circles,
			// excluding themselves — so a solo circle honestly reads "+0
			// People" and someone in two overlapping circles isn't double
			// counted.
			prisma.groupMember.findMany({
				where: {
					groupId: { in: groupIds },
					status: "approved",
					userId: { not: user.id },
				},
				select: { userId: true },
				distinct: ["userId"],
			}),
		]);

		// Which of those circles the user has already paid for this cycle.
		const paid = await prisma.contribution.findMany({
			where: {
				userId: user.id,
				groupId: { in: circles.map((c) => c.id) },
				status: { in: ["pending", "confirmed"] },
			},
			select: { groupId: true, cycle: true },
		});

		const paidKeys = new Set(paid.map((c) => `${c.groupId}:${c.cycle}`));

		return json({
			// Largest single asset — a real figure in a real currency, never a
			// cross-currency sum. Use `assets` for the full picture.
			saved_balance: headline.saved,
			asset_code: headline.asset_code,
			assets,
			people_total: people.length,
			circles: circles.map((group) => ({
				id: group.id,
				name: group.name,
				status: group.status,
				asset_code: group.assetCode,
				contribution_amount: group.contributionAmount,
				member_count: group._count.members,
				current_cycle: group.currentCycle,
				contributed_this_cycle: paidKeys.has(
					`${group.id}:${group.currentCycle}`,
				),
			})),
			circles_total: circlesTotal,
			has_more_circles: circlesTotal > circles.length,
			quick_deposit: await nextDue(groupIds, user.id),
		});
	});
}

/**
 * The soonest contribution the user still owes across their active groups.
 * Drives the "quick deposit" shortcut. Null when all caught up.
 */
async function nextDue(groupIds: bigint[], userId: bigint) {
	const active = await prisma.group.findMany({
		where: { id: { in: groupIds }, status: "active" },
		orderBy: { nextPayoutAt: "asc" },
	});

	if (active.length === 0) return null;

	const paid = await prisma.contribution.findMany({
		where: {
			userId,
			groupId: { in: active.map((g) => g.id) },
			status: { in: ["pending", "confirmed"] },
		},
		select: { groupId: true, cycle: true },
	});

	const paidKeys = new Set(paid.map((c) => `${c.groupId}:${c.cycle}`));

	// Prisma cannot compare a column to another column in a filter, so the
	// "unpaid for the group's CURRENT cycle" test happens here rather than in
	// SQL. Ordering is already applied, so the first match is the soonest due.
	const due = active.find(
		(group) => !paidKeys.has(`${group.id}:${group.currentCycle}`),
	);

	if (!due) return null;

	// Quick deposit IS the ordinary contribution for the soonest-due circle —
	// same amount, same cycle, same endpoint. Surfacing the exact contribute
	// endpoint keeps the dashboard button on the normal flow rather than any
	// separate deposit mechanism.
	return {
		group_id: due.id,
		group_name: due.name,
		amount: due.contributionAmount,
		asset_code: due.assetCode,
		cycle: due.currentCycle,
		due_at: due.nextPayoutAt,
		contribute_endpoint: `/api/groups/${due.id}/contributions`,
	};
}
