/**
 * The user's notifications — paginated, newest first, with the unread count.
 *
 * Scoped to `requireUser`, so this returns only the caller's own rows. The
 * browser ALSO reads this table directly over Supabase Realtime; that path is
 * constrained separately by row-level security (see the migration), because it
 * does not pass through this handler.
 */

import { z } from "zod";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { handle, json, parseQuery } from "@/server/http";
import { serializeNotification } from "@/server/serializers";

const schema = z.object({
	/** `true` narrows to unread only — what the bell's dropdown shows. */
	unread: z
		.enum(["true", "false"])
		.optional()
		.transform((value) => value === "true"),
	per_page: z.coerce.number().int().min(1).max(50).default(20),
	page: z.coerce.number().int().min(1).default(1),
});

export async function GET(request: Request) {
	return handle(async () => {
		const user = await requireUser(request);
		const { unread, per_page: perPage, page } = parseQuery(request, schema);

		const where = {
			userId: user.id,
			...(unread && { readAt: null }),
		};

		// `unreadCount` is counted independently of the page filter — the badge
		// must show every unread notification, not just those on this page.
		const [total, unreadCount, rows] = await Promise.all([
			prisma.notification.count({ where }),
			prisma.notification.count({ where: { userId: user.id, readAt: null } }),
			prisma.notification.findMany({
				where,
				orderBy: { createdAt: "desc" },
				skip: (page - 1) * perPage,
				take: perPage,
			}),
		]);

		return json({
			data: rows.map(serializeNotification),
			unread_count: unreadCount,
			current_page: page,
			per_page: perPage,
			total,
			last_page: Math.max(1, Math.ceil(total / perPage)),
		});
	});
}
