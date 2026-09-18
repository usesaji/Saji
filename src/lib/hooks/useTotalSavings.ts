"use client";

import { useMemo } from "react";
import type { DashboardData } from "../api";
import { useSajiBalance } from "./useSajiBalance";
import { toStroopsOrZero } from "../stroops";

/** One asset's complete position: what's withdrawable plus what's still locked. */
export type TotalAsset = {
	asset_code: string;
	/** Claimable payouts + wallet balance. Stroops. */
	withdrawable: bigint;
	/** Contributed but not yet rotated back — still working in circles. Stroops. */
	inCircles: bigint;
	/** withdrawable + inCircles. Stroops. */
	total: bigint;
};

export type TotalSavings = {
	/** Every asset the user holds anything in, largest first. */
	assets: TotalAsset[];
	/** The largest asset — what the headline figure shows. */
	headline: TotalAsset | null;
	/** Summed across assets, for deciding whether to show an empty state. */
	hasAnything: boolean;
	withdrawableTotalAcrossAssets: bigint;
	inCirclesTotalAcrossAssets: bigint;
	loading: boolean;
	/**
	 * The on-chain half could not be read. The card must say so rather than
	 * render a smaller number — silently dropping the withdrawable half would
	 * tell a user with a payout waiting that it doesn't exist.
	 */
	error: string | null;
};

/**
 * Everything the user's money adds up to, per asset.
 *
 * The overview headline needs to answer "what have I got", and neither existing
 * source answers it alone:
 *
 *   • `dashboard.assets` is contributed MINUS paid back — money locked in
 *     circles. It goes DOWN when you receive your payout, and reads zero once a
 *     circle completes, which looks like an empty account rather than a
 *     successful one.
 *   • `useSajiBalance` is only what's withdrawable right now — zero for someone
 *     mid-cycle who has contributed and isn't owed a payout yet.
 *
 * Added together they cover the whole position. Kept per asset throughout: a
 * circle saves in exactly one token, so summing XLM into USDC would produce a
 * figure in no currency at all.
 *
 * All amounts are bigint stroops (see `lib/stroops`) — `Number` would truncate
 * an i128 above 2^53, which on a balance means understating someone's money.
 */
export function useTotalSavings(data: DashboardData | null): TotalSavings {
	const saji = useSajiBalance();

	return useMemo(() => {
		const byAsset = new Map<string, TotalAsset>();
		const entryFor = (code: string): TotalAsset => {
			const existing = byAsset.get(code);
			if (existing) return existing;
			const created: TotalAsset = {
				asset_code: code,
				withdrawable: 0n,
				inCircles: 0n,
				total: 0n,
			};
			byAsset.set(code, created);
			return created;
		};

		// Withdrawable: claimable payouts + wallet, read from chain.
		for (const asset of saji.assets) {
			entryFor(asset.asset_code).withdrawable += asset.total;
		}

		// Still in circles: contributed less what has rotated back (from the DB).
		// `saved` is a decimal string, so it goes through the exact parser rather
		// than Number().
		for (const asset of data?.assets ?? []) {
			entryFor(asset.asset_code).inCircles += toStroopsOrZero(asset.saved);
		}

		const assets = [...byAsset.values()]
			.map((a) => ({ ...a, total: a.withdrawable + a.inCircles }))
			.filter((a) => a.total > 0n)
			// bigint can't go through a numeric sort comparator.
			.sort((a, b) => (b.total > a.total ? 1 : b.total < a.total ? -1 : 0));

		const withdrawableTotalAcrossAssets = assets.reduce(
			(sum, a) => sum + a.withdrawable,
			0n,
		);
		const inCirclesTotalAcrossAssets = assets.reduce(
			(sum, a) => sum + a.inCircles,
			0n,
		);

		return {
			assets,
			headline: assets[0] ?? null,
			hasAnything: assets.length > 0,
			withdrawableTotalAcrossAssets,
			inCirclesTotalAcrossAssets,
			loading: saji.loading,
			error: saji.error,
		};
	}, [saji.assets, saji.loading, saji.error, data?.assets]);
}
