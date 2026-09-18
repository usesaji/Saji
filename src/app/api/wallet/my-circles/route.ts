/**
 * The user's live on-chain circles — pure DB, no RPC.
 *
 * Ported from `WalletController::myCircles`.
 *
 * Lets the FRONTEND read each circle's claimable payout directly from the
 * chain. In the Laravel deployment this existed because RPC reads failed from
 * the web worker; here the server can reach the RPC fine, but the endpoint is
 * still worth keeping: reading claimables in the browser avoids a serial fan-out
 * of contract simulations inside one request, which is the slowest part of
 * `/wallet/saji-balance`.
 */

import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { handle, json } from "@/server/http";

export async function GET(request: Request) {
	return handle(async () => {
		const user = await requireUser(request);

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

		return json({
			stellar_address: user.stellarAddress,
			circles: groups.map((group) => ({
				group_id: group.id,
				onchain_group_id: group.onchainGroupId,
				group_name: group.name,
				asset_code: group.assetCode,
			})),
		});
	});
}
