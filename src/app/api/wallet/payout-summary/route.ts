/**
 * Per-asset summary of what Saji has actually PAID this user, and how much of
 * it is still sitting unclaimed in escrow.
 *
 * Ported from `WalletController::payoutSummary`.
 *
 * The withdraw screen uses `owed` to cap the "in your wallet" figure. Without
 * it the frontend counted every supported asset the wallet held — including
 * funds the user put there themselves, which Saji has no business offering to
 * withdraw.
 *
 * `owed` is NOT `paid_total` minus the client-logged `withdrawn_total`: the
 * withdraw-log routes record a client-SELF-REPORTED amount purely for
 * activity-feed display (see `wallet/withdraw/log`), and trusting it here
 * would let a client under-report a withdrawal to inflate `owed` — not a
 * fund-safety hole (the chain is what actually gates a claim/transfer), but
 * it would make the withdraw screen believe money is still claimable when
 * it's already gone. Instead, each CONFIRMED payout is cross-checked against
 * the contract's own `claimable_of` for its circle: once that reads zero the
 * payout has necessarily been claimed already, regardless of what any client
 * ever logged, since `claim_payout` is what zeroes it on-chain.
 *
 * All arithmetic is in BigInt stroops. Summing money as floats drifts, and this
 * figure decides how much a user is allowed to move.
 */

import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { handle, json } from "@/server/http";
import { claimableOf, fromStroops, toStroops } from "@/server/stellar/service";

export async function GET(request: Request) {
	return handle(async () => {
		const user = await requireUser(request);

		if (!user.stellarAddress) {
			return json({ assets: [] });
		}

		// Confirmed payouts, attributed to the paying circle's asset and
		// on-chain group id (needed to cross-check against claimable_of).
		const payouts = await prisma.payout.findMany({
			where: { recipientId: user.id, status: "confirmed" },
			select: {
				netAmount: true,
				group: {
					select: { id: true, assetCode: true, onchainGroupId: true },
				},
			},
			orderBy: { confirmedAt: "asc" },
		});

		const paid = new Map<string, bigint>();
		const owed = new Map<string, bigint>();

		// claimable_of sums ALL of a member's unclaimed payouts in one circle —
		// not per-row — so it must be read once per group and distributed
		// across that group's payout rows, oldest first, rather than read
		// (and double-counted) once per row.
		const byGroup = new Map<bigint, typeof payouts>();
		for (const payout of payouts) {
			const list = byGroup.get(payout.group.id) ?? [];
			list.push(payout);
			byGroup.set(payout.group.id, list);
		}

		// Groups are independent — read every circle's claimable_of concurrently
		// rather than one RPC round-trip at a time (this gates a page load).
		const groups = [...byGroup.values()];
		const claimableReads = await Promise.all(
			groups.map(async (groupPayouts) => {
				const { onchainGroupId } = groupPayouts[0].group;
				if (onchainGroupId === null) return null;
				try {
					return await claimableOf(onchainGroupId, user.stellarAddress!);
				} catch {
					return null; // RPC hiccup — fall back to assuming fully unclaimed.
				}
			}),
		);

		groups.forEach((groupPayouts, index) => {
			const { assetCode } = groupPayouts[0].group;
			const netAmounts = groupPayouts.map((p) => toStroops(p.netAmount.toString()));
			const groupTotal = netAmounts.reduce((a, b) => a + b, 0n);

			paid.set(assetCode, (paid.get(assetCode) ?? 0n) + groupTotal);

			// A read failure or a since-unlinked group is treated as "not yet
			// claimed" — the safe direction, since understating `owed` only
			// hides money the user can still find on the circle page, while
			// overstating it would offer to send funds that aren't there.
			const stillClaimable = claimableReads[index] ?? groupTotal;

			// Distribute the single live claimable figure across this group's
			// payout rows, oldest first, so a partial claim can't be
			// double-counted or misattributed to the wrong row.
			let remaining = stillClaimable < groupTotal ? stillClaimable : groupTotal;
			for (const net of netAmounts) {
				const unclaimed = net < remaining ? net : remaining;
				owed.set(assetCode, (owed.get(assetCode) ?? 0n) + unclaimed);
				remaining -= unclaimed;
			}
		});

		const assets = [...paid.entries()].map(([code, total]) => ({
			asset_code: code,
			paid_total: fromStroops(total),
			withdrawn_total: fromStroops(total - (owed.get(code) ?? 0n)),
			owed: fromStroops(owed.get(code) ?? 0n),
		}));

		return json({ assets });
	});
}
