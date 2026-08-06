/**
 * The Invite Link page: the organizer fetches the shareable join link.
 *
 * Ported from `GroupController::inviteLink`. Backed by the group's unguessable
 * invite token, which is the only way into a private circle.
 */

import { prisma } from "@/server/db";
import { generateInviteToken, requireUser } from "@/server/auth";
import { forbidden, handle, json } from "@/server/http";
import { findGroupOr404 } from "@/server/groups";

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ groupId: string }> },
) {
	return handle(async () => {
		const user = await requireUser(request);
		const { groupId } = await params;

		const group = await findGroupOr404(groupId);

		if (group.organizerId !== user.id) {
			throw forbidden("Only the organizer can view the invite link.");
		}

		// Lazily mint a token for groups created before this feature existed.
		let token = group.inviteToken;
		if (!token) {
			token = generateInviteToken();
			await prisma.group.update({
				where: { id: group.id },
				data: { inviteToken: token },
			});
		}

		// FRONTEND_URL may list several origins for CORS; only the FIRST is the
		// canonical one to build a shareable link from.
		const frontend = (process.env.FRONTEND_URL ?? "")
			.split(",")[0]
			.trim()
			.replace(/\/$/, "");

		return json({
			invite_token: token,
			invite_url: frontend ? `${frontend}/groups/join/${token}` : null,
		});
	});
}
