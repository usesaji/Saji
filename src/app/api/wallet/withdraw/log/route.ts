/**
 * Log a withdrawal that was built and broadcast CLIENT-SIDE.
 *
 * Ported from `WalletController::logWithdrawal`.
 *
 * The frontend settles some withdrawals itself via the contract bindings and
 * already holds the real on-chain hash; this just records the Transaction so it
 * shows in history. The indexer's status finalizer flips it to success/failed
 * from the chain — this endpoint never decides that on the client's say-so.
 */

import { z } from "zod";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { handle, json, parseBody } from "@/server/http";
import { explorerUrl } from "@/server/stellar/service";

const schema = z.object({
	// Nullable: a payout claimed STRAIGHT to the destination is settled by the
	// contract call itself, so the client has no separate payment hash.
	tx_hash: z.string().max(255).nullish(),
	amount: z.union([
		z
			.string()
			.regex(/^\d+(\.\d{1,7})?$/, "Must be a number with at most 7 decimals"),
		z.number().positive(),
	]),
	asset_code: z.string().max(12).nullish(),
});

export async function POST(request: Request) {
	return handle(async () => {
		const user = await requireUser(request);
		const data = await parseBody(request, schema);

		const hash = data.tx_hash ?? null;

		const tx = await prisma.transaction.create({
			data: {
				userId: user.id,
				type: "payout",
				stellarTxHash: hash,
				// With no hash there is nothing for the indexer to finalize —
				// the contract call already settled it, so record success.
				status: hash ? "pending" : "success",
				explorerUrl: hash ? explorerUrl(hash) : null,
				meta: {
					kind: "withdrawal",
					amount: String(data.amount),
					asset_code: data.asset_code ?? "USDC",
				},
			},
		});

		return json(tx, 201);
	});
}
