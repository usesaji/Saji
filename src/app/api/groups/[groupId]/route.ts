/**
 * A single group. Ported from `GroupController::show`.
 *
 * Note `params` is a Promise in Next 16 and must be awaited.
 */

import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { handle, json } from "@/server/http";
import { assertVisible, findGroupOr404 } from "@/server/groups";

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

		return json({ ...group, members, members_count: members.length });
	});
}
