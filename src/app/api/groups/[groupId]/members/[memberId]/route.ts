/**
 * Decline a pending join request.
 *
 * Ported from `GroupController::decline`.
 *
 * Only PENDING requests can be declined — an approved member may already be
 * admitted on-chain, and removing them is a different flow with contract
 * consequences. Declining deletes the row so the request disappears from the
 * organizer's list.
 */

import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { HttpError, handle, json, notFound } from "@/server/http";
import { assertOrganizer, findGroupOr404, parseBigInt } from "@/server/groups";

export async function DELETE(
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

		const member = await prisma.groupMember.findUnique({
			where: { id: parsed },
		});

		// A member of a DIFFERENT group 404s rather than 403 — the organizer of
		// one circle has no business learning which ids exist in another.
		if (!member || member.groupId !== group.id) throw notFound("Member");

		if (member.status !== "pending") {
			throw new HttpError(422, "Only pending requests can be declined.");
		}

		await prisma.groupMember.delete({ where: { id: member.id } });

		return json({ message: "Request declined." });
	});
}
