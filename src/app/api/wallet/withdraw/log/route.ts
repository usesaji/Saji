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
import { serializeTransaction } from "@/server/serializers";
import { emitAfterResponse } from "@/server/notifications";

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
					// PROVENANCE, and it matters: `amount` is what the CLIENT said it
					// moved. Nothing here verifies it against the chain, because the
					// server is not in this flow — the browser calls claim_payout /
					// transfer itself and this endpoint only writes history.
					//
					// That is safe ONLY because no balance is derived from it.
					// `wallet/payout-summary` computes what a user is owed from the
					// contract's own `claimable_of`, never from these rows (see the
					// note at the top of that route). If anything ever starts summing
					// `meta.amount` into a spendable figure, this flag is the marker
					// that it must not: a client could under-report to inflate it.
					amount_source: "client_reported",
				},
			},
		});

		// Confirmation that money left, keyed on the row we just wrote so a
		// client retry cannot double-notify. Deliberately still sent even though
		// the user performed this action themselves: a withdrawal is the one
		// event where a record arriving somewhere they DIDN'T initiate it is the
		// point — it is how they notice one they did not make.
		emitAfterResponse({
			userId: user.id,
			type: "withdrawal_sent",
			dedupeKey: `withdrawal:${tx.id}`,
			title: "Withdrawal sent",
			body: `${data.amount} ${data.asset_code ?? "USDC"} is on its way to your destination. If this wasn't you, secure your wallet immediately.`,
			href: "/transactions",
			meta: {
				amount: String(data.amount),
				asset_code: data.asset_code ?? "USDC",
				...(hash && { stellar_tx_hash: hash }),
			},
		});

		return json(serializeTransaction(tx), 201);
	});
}
