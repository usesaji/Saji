/**
 * Per-asset summary of what Saji has actually PAID this user, and how much of
 * it is still sitting unclaimed in escrow.
 *
 * Ported from `WalletController::payoutSummary`.
 *
 * Two figures come out of this and they are OPPOSITES. Conflating them is what
 * made the withdraw screen wrong in both directions:
 *
 *   `owed`           — still sitting UNCLAIMED in the contract's escrow.
 *   `released_total` — already claimed OUT of escrow (`paid_total - owed`).
 *
 * `released_total` is the one the withdraw screen needs to bound its "in your
 * wallet" figure, because `claim_payout` releases a payout IN FULL: a partial
 * withdrawal claims the whole thing home and leaves the remainder sitting in
 * the user's own wallet.
 *
 * The withdraw screen used to bound that figure with `owed`, which is exactly
 * backwards and broke both ways:
 *
 *   - after any partial withdrawal, `owed` drops to zero, so the money that had
 *     just landed in the user's wallet became INVISIBLE ("Nothing to withdraw
 *     yet" while holding a real payout);
 *   - before claiming, `owed` equals the escrowed payout, so any of the user's
 *     OWN funds in the same wallet were counted a second time on top of the
 *     claimable — offering to move money Saji never paid them.
 *
 * Both directions are capped against the live wallet balance by the caller, so
 * `released_total` shrinks correctly once the user actually sends funds out.
 *
 * NEITHER figure is derived from the client-logged withdrawal amounts: the
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
			// RELEASED, not "withdrawn" — the name this field used to carry. It
			// counts what has left ESCROW, which is NOT the same as what has left
			// the user: claiming a payout to your own wallet releases it in full
			// and moves it nowhere else. The old name is what led the withdraw
			// screen to reach for `owed` instead and invert the meaning.
			released_total: fromStroops(total - (owed.get(code) ?? 0n)),
			owed: fromStroops(owed.get(code) ?? 0n),
		}));

		return json({ assets });
	});
}
