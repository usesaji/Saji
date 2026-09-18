/**
 * Transaction history — paginated, newest first.
 *
 * Ported from `TransactionController::index`.
 *
 * A transaction row is the off-chain mirror of a Stellar tx (contribution,
 * payout, group creation…). Each carries the explorer URL so the user can
 * verify it on-chain — the ledger stays the source of truth.
 */

import { z } from "zod";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { handle, json, parseQuery } from "@/server/http";
import { serializeTransaction } from "@/server/serializers";
import type { Prisma } from "@prisma/client";

const schema = z.object({
	type: z
		.enum(["create_group", "join", "contribution", "payout", "other"])
		.optional(),
	status: z.enum(["pending", "success", "failed"]).optional(),
	q: z.string().max(100).optional(),
	per_page: z.coerce.number().int().min(1).max(100).default(20),
	page: z.coerce.number().int().min(1).default(1),
});

export async function GET(request: Request) {
	return handle(async () => {
		const user = await requireUser(request);
		const params = parseQuery(request, schema);

		const where: Prisma.TransactionWhereInput = {
			userId: user.id,
			...(params.type && { type: params.type }),
			...(params.status && { status: params.status }),
			// Free-text search across the tx hash and the group name.
			//
			// `type` is a Postgres enum here, so it cannot take a LIKE the way
			// it did in Laravel's SQLite. Searching a hash or a circle name is
			// what the box is actually for; type is already a filter dropdown.
			...(params.q && {
				OR: [
					{ stellarTxHash: { contains: params.q, mode: "insensitive" } },
					{ group: { name: { contains: params.q, mode: "insensitive" } } },
				],
			}),
		};

		const [total, data] = await Promise.all([
			prisma.transaction.count({ where }),
			prisma.transaction.findMany({
				where,
				include: { group: { select: { id: true, name: true } } },
				orderBy: { createdAt: "desc" },
				skip: (params.page - 1) * params.per_page,
				take: params.per_page,
			}),
		]);

		return json({
			data: data.map((tx) => ({ ...serializeTransaction(tx), group: tx.group })),
			current_page: params.page,
			per_page: params.per_page,
			total,
			last_page: Math.max(1, Math.ceil(total / params.per_page)),
		});
	});
}
