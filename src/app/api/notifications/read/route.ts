/**
 * Mark notifications read.
 *
 * `POST { ids: [...] }` marks those; `POST { all: true }` clears the badge.
 *
 * A write, so it goes through the API rather than the browser's Realtime
 * connection — that connection is granted SELECT only (see the migration), and
 * deliberately: the client should never be able to write this table.
 */

import { z } from "zod";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { handle, json, parseBody } from "@/server/http";

const schema = z
	.object({
		// Ids are serialised as strings (BigInt), so accept them back that way.
		ids: z.array(z.union([z.number().int(), z.string().regex(/^\d+$/)])).optional(),
		all: z.boolean().optional(),
	})
	.refine((data) => data.all || (data.ids && data.ids.length > 0), {
		message: "Pass either `all: true` or a non-empty `ids` array.",
	});

export async function POST(request: Request) {
	return handle(async () => {
		const user = await requireUser(request);
		const data = await parseBody(request, schema);

		const now = new Date();

		// `userId` is in the WHERE clause, not just the lookup — without it, a
		// caller could pass another user's notification ids and mark them read.
		// Ids belonging to someone else simply match nothing.
		const result = await prisma.notification.updateMany({
			where: {
				userId: user.id,
				readAt: null,
				...(data.all
					? {}
					: { id: { in: data.ids!.map((id) => BigInt(id)) } }),
			},
			data: { readAt: now },
		});

		const unreadCount = await prisma.notification.count({
			where: { userId: user.id, readAt: null },
		});

		return json({ marked: result.count, unread_count: unreadCount });
	});
}
