/**
 * Step 1 of linking a wallet: issue a signable proof-of-control challenge.
 *
 * See `@/server/wallet-proof` for why this exists — without it, `PATCH
 * /api/profile/wallet` would accept any syntactically valid address with no
 * proof the caller actually holds its key.
 */

import { z } from "zod";
import { requireUser } from "@/server/auth";
import { handle, json, parseBody } from "@/server/http";
import { createWalletChallenge } from "@/server/wallet-proof";

const schema = z.object({
	stellar_address: z
		.string()
		.regex(/^G[A-Z2-7]{55}$/, "That is not a valid Stellar public address."),
});

export async function POST(request: Request) {
	return handle(async () => {
		await requireUser(request);
		const { stellar_address: address } = await parseBody(request, schema);

		return json({ unsigned_xdr: await createWalletChallenge(address) });
	});
}
