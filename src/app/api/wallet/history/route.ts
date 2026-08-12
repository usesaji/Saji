/**
 * Wallet history: the user's on-chain transactions, newest first.
 *
 * Ported from `WalletController::history`. Keeps Laravel's paginator response
 * shape (`data`, `current_page`, `last_page`, `total`, `per_page`) because the
 * frontend already reads those keys.
 */

import { z } from "zod";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { handle, json, parseQuery } from "@/server/http";
import { serializeTransaction } from "@/server/serializers";
import { resolveSubjectAmounts, transactionLabel } from "@/server/subjects";

const schema = z.object({
	per_page: z.coerce.number().int().min(1).max(100).default(20),
	page: z.coerce.number().int().min(1).default(1),
});

export async function GET(request: Request) {
	return handle(async () => {
		const user = await requireUser(request);
		const { per_page: perPage, page } = parseQuery(request, schema);

		const where = { userId: user.id };

		const [total, data] = await Promise.all([
			prisma.transaction.count({ where }),
			prisma.transaction.findMany({
				where,
				include: { group: { select: { id: true, name: true } } },
				orderBy: { createdAt: "desc" },
				skip: (page - 1) * perPage,
				take: perPage,
			}),
		]);

		// The amount and the DIRECTION, neither of which is on the row itself.
		// Without these the wallet history listed every withdrawal as "payout"
		// with no figure — indistinguishable from money arriving.
		const amounts = await resolveSubjectAmounts(data);

		return json({
			data: data.map((tx) => ({
				...serializeTransaction(tx),
				group: tx.group,
				kind: transactionLabel(tx),
				amount: amounts.get(tx.id) ?? null,
			})),
			current_page: page,
			per_page: perPage,
			total,
			last_page: Math.max(1, Math.ceil(total / perPage)),
		});
	});
}
