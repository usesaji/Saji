/**
 * The authenticated member's progress toward the challenge target.
 *
 * Ported from `ChallengeController::myProgress`.
 */

import { requireUser } from "@/server/auth";
import { handle, json } from "@/server/http";
import { findGroupOr404 } from "@/server/groups";
import {
	assertChallengeMember,
	confirmedSavingsByMember,
	percentOf,
} from "@/server/challenges";
import { fromStroops, toStroops } from "@/server/stellar/service";

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ groupId: string }> },
) {
	return handle(async () => {
		const user = await requireUser(request);
		const { groupId } = await params;

		const group = await findGroupOr404(groupId);
		await assertChallengeMember(group, user.id);

		const totals = await confirmedSavingsByMember(group.id);
		const saved = totals.get(user.id) ?? 0n;
		const target = group.savingsTarget
			? toStroops(group.savingsTarget.toString())
			: 0n;

		return json({
			group_id: group.id,
			saved: fromStroops(saved),
			target: fromStroops(target),
			percent: percentOf(saved, target),
			reached: target > 0n && saved >= target,
			challenge_ends_at: group.challengeEndsAt,
		});
	});
}
