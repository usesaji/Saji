/**
 * Join a public challenge — open, instant, no invite or approval.
 *
 * Ported from `PublicCircleController::join`.
 */

import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { handle, json, notFound } from "@/server/http";
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

		const existing = await prisma.groupMember.findUnique({
			where: { groupId_userId: { groupId: group.id, userId: user.id } },
		});

		// Idempotent: joining twice returns the existing membership rather than
		// resetting its state.
		if (existing) return json(existing, 200);

		const member = await prisma.groupMember.create({
			data: {
				groupId: group.id,
				userId: user.id,
				status: "approved",
				joinedAt: new Date(),
			},
		});

		return json(member, 201);
	});
}
