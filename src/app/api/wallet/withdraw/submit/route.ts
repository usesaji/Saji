/**
 * Broadcast the wallet-signed withdrawal and log it.
 *
 * Ported from `WalletController::submitWithdraw`.
 *
 * We relay the user's OWN signed payment — self-custody means they can only
 * move their own funds. The hash and status come straight from the RPC, never
 * from the client.
 *
 * `sendTransaction` returns PENDING; the tx only becomes final on-chain shortly
 * after. We record it as pending and let the indexer's status finalizer flip it,
 * rather than optimistically claiming success on the client's round trip.
 */

import { z } from "zod";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { HttpError, handle, json, parseBody } from "@/server/http";
import { explorerUrl, submitSignedXdr } from "@/server/stellar/service";
import { serializeTransaction } from "@/server/serializers";

const schema = z.object({
	signed_xdr: z.string().min(1),
});

export async function POST(request: Request) {
	return handle(async () => {
		const user = await requireUser(request);
		const data = await parseBody(request, schema);

		let hash: string;
		try {
			hash = await submitSignedXdr(data.signed_xdr);
		} catch (error) {
			console.error("[wallet] withdraw submit failed:", error);
			throw new HttpError(
				422,
				"The network rejected that transaction. It may have expired — please try the withdrawal again.",
			);
		}

		const tx = await prisma.transaction.create({
			data: {
				userId: user.id,
				// A withdrawal is a payout to the member's own wallet.
				type: "payout",
				stellarTxHash: hash,
				status: "pending",
				explorerUrl: explorerUrl(hash),
				meta: { kind: "withdrawal" },
			},
		});

		return json(serializeTransaction(tx), 201);
	});
}
