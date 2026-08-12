/**
 * Organizer approves a pending member and fixes their rotation position.
 *
 * Ported from `GroupController::approve`.
 */

import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { handle, json, notFound } from "@/server/http";
import { assertOrganizer, findGroupOr404, parseBigInt } from "@/server/groups";
import { serializeMember } from "@/server/serializers";
import { emitAfterResponse } from "@/server/notifications";

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ groupId: string; memberId: string }> },
) {
	return handle(async () => {
		const user = await requireUser(request);
		const { groupId, memberId } = await params;

		const group = await findGroupOr404(groupId);
		assertOrganizer(group, user.id);

		const parsed = parseBigInt(memberId);
		if (parsed === null) throw notFound("Member");

		const existing = await prisma.groupMember.findUnique({
			where: { id: parsed },
			include: { user: { select: { stellarAddress: true } } },
		});

		if (!existing || existing.groupId !== group.id) throw notFound("Member");

		// No interactive transaction here: Supabase's pooler can reject a
		// $transaction's opening BEGIN outright (P2028), and this read-then-write
		// has no hard invariant to protect — the worst case of a genuine
		// simultaneous double-approval is two members sharing a payoutPosition,
		// which is a cosmetic ordering glitch (re-sequenced later via the
		// payout-order screen), not a money-safety issue. Not worth the P2028
		// exposure to close a race this narrow.
		const last = await prisma.groupMember.aggregate({
			where: { groupId: group.id },
			_max: { payoutPosition: true },
		});

		const member = await prisma.groupMember.update({
			where: { id: existing.id },
			data: {
				status: "approved",
				payoutPosition: (last._max.payoutPosition ?? 0) + 1,
				joinedAt: new Date(),
			},
		});

		// The approval is the completed action — tell the member now, after the
		// response is flushed. Keyed on the membership row, so an organizer
		// re-approving cannot send a second email.
		emitAfterResponse({
			userId: member.userId,
			type: "join_approved",
			dedupeKey: `join_approved:${member.id}`,
			title: `You're in — ${group.name}`,
			body: `Your request to join "${group.name}" was approved. You'll be able to contribute once the organizer starts the cycle.`,
			href: `/groups/${group.id}`,
			meta: { group_id: String(group.id), group_name: group.name },
		});

		// Non-custodial: admitting a member on-chain is authorized by the
		// ORGANIZER's wallet — they sign, and the member is an argument. That
		// happens in the browser via the contract bindings; this route records
		// the approval off-chain. The unsigned join_group XDR built here
		// previously had no consumer — see the note in `POST /api/groups`.
		return json({ member: serializeMember(member) });
	});
}
