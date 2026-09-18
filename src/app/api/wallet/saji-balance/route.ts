/**
 * "Saji balance" — the user's withdrawable money, broken down PER ASSET.
 *
 * Ported from `WalletController::sajiBalance`.
 *
 * Different tokens cannot be summed into one figure, so each asset carries its
 * own wallet balance, claimable circle payouts, total, and the circles making
 * up that claimable. Non-custodial: claimable funds sit escrowed in the
 * contract, not with Saji.
 *
 * All arithmetic is BigInt stroops, summed before conversion to a decimal
 * string. Adding floats here would drift in the last decimal places.
 */

import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { handle, json } from "@/server/http";
import {
	claimableOf,
	fromStroops,
	getTokenBalance,
	tokenSacs,
} from "@/server/stellar/service";

export async function GET(request: Request) {
	return handle(async () => {
		const user = await requireUser(request);

		if (!user.stellarAddress) {
			return json({ linked: false, assets: [] });
		}

		const address = user.stellarAddress;

		// The user's live circles, so claimables can be attributed to an asset.
		const groups = await prisma.group.findMany({
			where: {
				onchainGroupId: { not: null },
				members: { some: { userId: user.id, status: "approved" } },
			},
			select: {
				id: true,
				name: true,
				onchainGroupId: true,
				assetCode: true,
			},
		});

		const assets = [];

		for (const [code, sac] of Object.entries(tokenSacs())) {
			// Wallet balance for THIS token — each asset read against its own SAC.
			let walletStroops: bigint | null = null;
			try {
				walletStroops = await getTokenBalance(address, sac);
			} catch (error) {
				console.warn(`[wallet] ${code} balance read failed:`, error);
			}

			// Claimable circle payouts denominated in this asset.
			const claimables = [];
			let claimableTotal = 0n;

			for (const group of groups.filter((g) => g.assetCode === code)) {
				let stroops: bigint;
				try {
					stroops = await claimableOf(group.onchainGroupId!, address);
				} catch (error) {
					console.warn(`[wallet] claimable read failed for ${group.id}:`, error);
					continue;
				}

				if (stroops <= 0n) continue;

				claimableTotal += stroops;
				claimables.push({
					group_id: group.id,
					onchain_group_id: group.onchainGroupId,
					group_name: group.name,
					asset_code: code,
					amount: fromStroops(stroops),
				});
			}

			assets.push({
				asset_code: code,
				wallet_amount:
					walletStroops !== null ? fromStroops(walletStroops) : null,
				claimable_total: fromStroops(claimableTotal),
				total:
					walletStroops !== null
						? fromStroops(walletStroops + claimableTotal)
						: null,
				claimables,
			});
		}

		return json({ linked: true, assets });
	});
}
