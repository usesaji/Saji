/**
 * Transaction Details screen for a single transaction.
 *
 * Ported from `TransactionController::show`. Scoped to the owner, and a
 * transaction belonging to someone else returns 404 rather than 403 — a 403
 * would confirm the id exists.
 */

import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { handle, json, notFound } from "@/server/http";
import { parseBigInt } from "@/server/groups";
import { resolveSubjectAmounts } from "@/server/subjects";

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	return handle(async () => {
		const user = await requireUser(request);
		const { id } = await params;

		const parsed = parseBigInt(id);
		if (parsed === null) throw notFound("Transaction");

		const transaction = await prisma.transaction.findUnique({
			where: { id: parsed },
			include: { group: { select: { id: true, name: true } } },
		});

		if (!transaction || transaction.userId !== user.id) {
			throw notFound("Transaction");
		}

		const amounts = await resolveSubjectAmounts([transaction]);

		return json({
			id: transaction.id,
			type: transaction.type,
			status: transaction.status,
			amount: amounts.get(transaction.id) ?? null,
			group: transaction.group,
			// "Transaction no" on the details screen — the on-chain hash, with a
			// verification link to the Stellar explorer.
			transaction_no: transaction.stellarTxHash,
			explorer_url: transaction.explorerUrl,
			date_time: transaction.createdAt,
		});
	});
}
