/**
 * Wallet header balance. Ported from `WalletController::balance`.
 *
 * NON-CUSTODIAL: this is a live read of the user's OWN linked Stellar wallet,
 * not a Saji ledger. There is no deposit-address step — funding is
 * connect-wallet + sign, and the savings contract pulls funds on contribution.
 */

import { requireUser } from "@/server/auth";
import { handle, json } from "@/server/http";
import { fromStroops, getTokenBalance } from "@/server/stellar/service";

export async function GET(request: Request) {
	return handle(async () => {
		const user = await requireUser(request);

		if (!user.stellarAddress) {
			return json({
				linked: false,
				stellar_address: null,
				amount: null,
				asset_code: "USDC",
			});
		}

		// Best-effort chain read. If the RPC can't be reached, return a null
		// amount rather than 500, so the wallet screen still renders the linked
		// address and history.
		let amount: string | null = null;
		try {
			amount = fromStroops(await getTokenBalance(user.stellarAddress));
		} catch (error) {
			console.warn("[wallet] balance read failed:", error);
		}

		return json({
			linked: true,
			stellar_address: user.stellarAddress,
			amount,
			asset_code: "USDC",
		});
	});
}
