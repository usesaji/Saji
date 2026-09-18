/**
 * Challenge summary + leaderboard.
 *
 * Ported from `ChallengeController::summary`.
 *
 * The shared target, how the group is doing collectively, and each member's
 * progress (accountability). Respects the group's `hide_balances` flag by
 * omitting per-member amounts entirely when set — the leaderboard becomes null
 * rather than an empty list, so the UI can tell "hidden" from "nobody saved".
 */

import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { handle, json, notFound } from "@/server/http";
import { findGroupOr404 } from "@/server/groups";
import { confirmedSavingsByMember, percentOf } from "@/server/challenges";
import { fromStroops, toStroops } from "@/server/stellar/service";

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ groupId: string }> },
) {
	return handle(async () => {
		await requireUser(request);
		const { groupId } = await params;

		const group = await findGroupOr404(groupId);
		if (group.circleKind !== "challenge") throw notFound("Challenge");

		const target = group.savingsTarget
			? toStroops(group.savingsTarget.toString())
			: 0n;

		const totals = await confirmedSavingsByMember(group.id);

		const memberCount = await prisma.groupMember.count({
			where: { groupId: group.id, status: "approved" },
		});

		let groupSaved = 0n;
		let reachedCount = 0;

		for (const saved of totals.values()) {
			groupSaved += saved;
			if (target > 0n && saved >= target) reachedCount += 1;
		}

		let leaderboard = null;

		if (!group.hideBalances && totals.size > 0) {
			const users = await prisma.user.findMany({
				where: { id: { in: [...totals.keys()] } },
				select: { id: true, name: true },
			});

			const names = new Map(users.map((u) => [u.id, u.name]));

			leaderboard = [...totals.entries()]
				.sort(([, a], [, b]) => (b > a ? 1 : b < a ? -1 : 0))
				.map(([userId, saved]) => ({
					user_id: userId,
					name: names.get(userId) ?? null,
					saved: fromStroops(saved),
					percent: percentOf(saved, target),
				}));
		}

		return json({
			group: {
				id: group.id,
				name: group.name,
				asset_code: group.assetCode,
				savings_target: fromStroops(target),
				challenge_ends_at: group.challengeEndsAt,
			},
			member_count: memberCount,
			group_saved_total: fromStroops(groupSaved),
			members_reached_target: reachedCount,
			hide_balances: group.hideBalances,
			leaderboard,
		});
	});
}
