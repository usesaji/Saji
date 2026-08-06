/**
 * Per-asset summary of what Saji has actually PAID this user, and how much of
 * it they have already withdrawn.
 *
 * Ported from `WalletController::payoutSummary`.
 *
 * The withdraw screen uses this to cap the "in your wallet" figure. Without it
 * the frontend counted every supported asset the wallet held — including funds
 * the user put there themselves, which Saji has no business offering to
 * withdraw.
 *
 * Pure DB, no RPC: this must stay available even when the network read path is
 * degraded, because it gates withdrawals.
 *
 * All arithmetic is in BigInt stroops. Summing money as floats drifts, and this
 * figure decides how much a user is allowed to move.
 */

import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { handle, json } from "@/server/http";
import { fromStroops, toStroops } from "@/server/stellar/service";

/** Shape of the `meta` blob written by the withdraw-log routes. */
interface WithdrawalMeta {
	kind?: string;
	amount?: string;
	asset_code?: string;
}

export async function GET(request: Request) {
	return handle(async () => {
		const user = await requireUser(request);

		// Confirmed payouts, attributed to the paying circle's asset.
		const payouts = await prisma.payout.findMany({
			where: { recipientId: user.id, status: "confirmed" },
			select: {
				netAmount: true,
				group: { select: { assetCode: true } },
			},
		});

		const paid = new Map<string, bigint>();

		for (const payout of payouts) {
			const code = payout.group.assetCode;
			paid.set(
				code,
				(paid.get(code) ?? 0n) + toStroops(payout.netAmount.toString()),
			);
		}

		// Withdrawals the client has logged, by asset. `meta` is JSON, so this
		// is filtered in application code rather than SQL.
		const withdrawals = await prisma.transaction.findMany({
			where: {
				userId: user.id,
				type: "payout",
				status: { in: ["pending", "success"] },
			},
			select: { meta: true },
		});

		const withdrawn = new Map<string, bigint>();

		for (const tx of withdrawals) {
			const meta = (tx.meta ?? {}) as WithdrawalMeta;
			if (meta.kind !== "withdrawal") continue;

			const code = meta.asset_code ?? "USDC";

			// A malformed amount must not abort the whole summary — skip it and
			// keep the rest of the figures correct.
			let amount: bigint;
			try {
				amount = toStroops(meta.amount ?? "0");
			} catch {
				continue;
			}

			withdrawn.set(code, (withdrawn.get(code) ?? 0n) + amount);
		}

		const assets = [...paid.entries()].map(([code, total]) => {
			const out = withdrawn.get(code) ?? 0n;
			// Clamp at zero: a user who withdrew more than Saji paid them (own
			// funds included) is not owed a negative amount.
			const owed = total > out ? total - out : 0n;

			return {
				asset_code: code,
				paid_total: fromStroops(total),
				withdrawn_total: fromStroops(out),
				// What Saji paid that hasn't been sent out yet.
				owed: fromStroops(owed),
			};
		});

		return json({ assets });
	});
}
