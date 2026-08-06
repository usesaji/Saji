/**
 * Activity / notification feed — one chronological stream of the user's
 * on-chain activity, filterable by the screen's tabs.
 *
 * Ported from `ActivityController::index`.
 *
 * Non-custodial note: "withdrawal" is not a separate on-chain action in Saji —
 * money leaves a circle as a `payout` to the recipient's own wallet. So the
 * withdrawal filter maps onto payout transactions.
 */

import { z } from "zod";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { handle, json, parseQuery } from "@/server/http";
import { resolveSubjectAmounts } from "@/server/subjects";
import type { TransactionType } from "@prisma/client";

const schema = z.object({
	filter: z
		.enum(["all", "contributions", "payout", "withdrawal"])
		.default("all"),
	per_page: z.coerce.number().int().min(1).max(100).default(20),
	page: z.coerce.number().int().min(1).default(1),
});

/** Map a screen filter to the concrete transaction types it covers. */
function typesFor(filter: string): TransactionType[] | null {
	switch (filter) {
		case "contributions":
			return ["contribution"];
		// Both "payout" and "withdrawal" surface payout transactions — a payout
		// is money leaving the circle to the member's wallet.
		case "payout":
		case "withdrawal":
			return ["payout"];
		default:
			return null; // 'all' — no type constraint
	}
}

export async function GET(request: Request) {
	return handle(async () => {
		const user = await requireUser(request);
		const { filter, per_page: perPage, page } = parseQuery(request, schema);

		const types = typesFor(filter);

		const where = {
			userId: user.id,
			...(types && { type: { in: types } }),
		};

		const [total, transactions] = await Promise.all([
			prisma.transaction.count({ where }),
			prisma.transaction.findMany({
				where,
				include: { group: { select: { id: true, name: true } } },
				orderBy: { createdAt: "desc" },
				skip: (page - 1) * perPage,
				take: perPage,
			}),
		]);

		// The amount lives on the settled subject (a contribution or payout),
		// so surface it alongside the tx metadata.
		const amounts = await resolveSubjectAmounts(transactions);

		return json({
			data: transactions.map((tx) => ({
				id: tx.id,
				type: tx.type,
				status: tx.status,
				group: tx.group,
				amount: amounts.get(tx.id) ?? null,
				stellar_tx_hash: tx.stellarTxHash,
				explorer_url: tx.explorerUrl,
				created_at: tx.createdAt,
			})),
			current_page: page,
			per_page: perPage,
			total,
			last_page: Math.max(1, Math.ceil(total / perPage)),
		});
	});
}
