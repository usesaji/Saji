/**
 * A single group. Ported from `GroupController::show`.
 *
 * Note `params` is a Promise in Next 16 and must be awaited.
 */

import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { handle, json } from "@/server/http";
import { assertVisible, findGroupOr404 } from "@/server/groups";
import { serializeGroup, serializeMember } from "@/server/serializers";

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ groupId: string }> },
) {
	return handle(async () => {
		const user = await requireUser(request);
		const { groupId } = await params;

		const group = await findGroupOr404(groupId);
		await assertVisible(group, user.id);

		const members = await prisma.groupMember.findMany({
			where: { groupId: group.id },
			include: {
				user: {
					select: {
						id: true,
						name: true,
						tagName: true,
						avatarUrl: true,
						stellarAddress: true,
					},
				},
			},
			orderBy: [{ payoutPosition: "asc" }, { createdAt: "asc" }],
		});

		// serializeGroup/serializeMember are NOT optional here — see the warning
		// in src/server/serializers.ts. Returning raw Prisma objects (camelCase)
		// against a frontend built for Eloquent's snake_case JSON silently
		// breaks every `data.organizer_id` / `m.user_id` lookup on the client.
		const membersOut = members.map(serializeMember);

		return json({
			...serializeGroup(group),
			members: membersOut,
			members_count: membersOut.length,
		});
	});
}
