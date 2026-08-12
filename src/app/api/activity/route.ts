/**
 * Activity / notification feed — one chronological stream of the user's
 * on-chain activity, filterable by the screen's tabs.
 *
 * Ported from `ActivityController::index`.
 *
 * Non-custodial note: a circle payout and a withdrawal are BOTH stored with
 * `type: "payout"`, because that is the transaction type the chain settles in
 * either case. They are nonetheless opposite directions of money:
 *
 *   - an incoming circle payout is written by the indexer and carries its
 *     `Payout` subject row;
 *   - an outgoing withdrawal is written by `wallet/withdraw/log` and carries
 *     no subject at all, only `meta`.
 *
 * That is what the filters and the `kind` field below key off. They used to be
 * treated as the same thing — "withdrawal is not a separate action" — so the
 * Payout and Withdrawal tabs returned byte-identical lists, and a withdrawal
 * rendered as "Payout Completed" in the feed.
 */

import { z } from "zod";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { handle, json, parseQuery } from "@/server/http";
import { resolveSubjectAmounts, transactionLabel } from "@/server/subjects";
import type { Prisma } from "@prisma/client";

const schema = z.object({
	filter: z
		.enum(["all", "contributions", "payout", "withdrawal"])
		.default("all"),
	per_page: z.coerce.number().int().min(1).max(100).default(20),
	page: z.coerce.number().int().min(1).default(1),
});

/**
 * Map a screen filter to the rows it covers.
 *
 * Payout vs. withdrawal is decided on `subjectId`, a plain indexed column: an
 * indexer-written circle payout always has its `Payout` subject, a logged
 * withdrawal never does. Deliberately NOT a `meta.kind` JSON filter — real
 * payout rows have no `meta` at all, and negating a JSON path over SQL NULL
 * would silently drop every one of them from the Payout tab.
 */
function whereFor(filter: string): Prisma.TransactionWhereInput {
	switch (filter) {
		case "contributions":
			return { type: "contribution" };
		case "payout":
			return { type: "payout", subjectId: { not: null } };
		case "withdrawal":
			return { type: "payout", subjectId: null };
		default:
			return {}; // 'all' — no constraint
	}
}

export async function GET(request: Request) {
	return handle(async () => {
		const user = await requireUser(request);
		const { filter, per_page: perPage, page } = parseQuery(request, schema);

		const where = {
			userId: user.id,
			...whereFor(filter),
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
				// The DIRECTION of the money, which `type` alone cannot express:
				// "payout" covers both an incoming circle payout and an outgoing
				// withdrawal. Clients must label from this, not from `type`.
				kind: transactionLabel(tx),
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
