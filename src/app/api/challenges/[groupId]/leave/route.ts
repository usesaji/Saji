/**
 * Leave a public challenge. Allowed freely — no rules, no lock.
 *
 * Ported from `PublicCircleController::leave`.
 */

import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { HttpError, handle, json, notFound } from "@/server/http";
import { findGroupOr404 } from "@/server/groups";

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ groupId: string }> },
) {
	return handle(async () => {
		const user = await requireUser(request);
		const { groupId } = await params;

		const group = await findGroupOr404(groupId);
		if (group.circleKind !== "challenge") throw notFound("Challenge");

		// The creator can't abandon their own challenge this way — it would
		// leave the circle without an organizer.
		if (group.organizerId === user.id) {
			throw new HttpError(
				422,
				"The creator cannot leave their own challenge.",
			);
		}

		await prisma.groupMember.deleteMany({
			where: { groupId: group.id, userId: user.id },
		});

		return json({ message: "You left the challenge." });
	});
}
