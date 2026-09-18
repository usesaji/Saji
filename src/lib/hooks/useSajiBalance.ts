"use client";

import { useCallback, useEffect, useState } from "react";
import { wallet as walletApi, profile as profileApi } from "../api";
import { useApi } from "./useApi";
import { useSavingsContract } from "./useSavingsContract";

/**
 * One asset's WITHDRAWABLE position: payouts a circle has earmarked for this
 * member and that are still sitting in escrow.
 *
 * Escrow ONLY. This deliberately does not include the user's own wallet
 * balance. It used to, and that was the bug behind "I pressed Withdraw and my
 * balance went DOWN": with wallet funds counted as withdrawable, asking for an
 * amount the wallet already covered skipped the claim entirely and sent the
 * user's own money out. Saji's job is to get money OUT of escrow — what is
 * already in your wallet is yours, and Freighter is where you spend it.
 */
export type SajiAsset = {
	asset_code: string;
	/** Escrowed across all circles in this asset. Stroops. */
	total: bigint;
	claimables: {
		group_id: number;
		onchain_group_id: number;
		group_name: string;
		asset_code: string;
		/** Stroops. Released in FULL — `claim_payout` takes no amount. */
		amount: bigint;
	}[];
};

export type SajiBalance = {
	/** Only assets with something ready to withdraw. */
	assets: SajiAsset[];
	loading: boolean;
	/**
	 * The balance could NOT be read (RPC failure). Callers must show this as a
	 * network problem — never as a zero balance, which would tell a user with a
	 * real payout that their money is gone.
	 */
	error: string | null;
	/** A Stellar address was resolvable (wallet linked). */
	linked: boolean;
	/** Anything ready to withdraw at all — gates the Withdraw CTA. */
	hasWithdrawable: boolean;
	address: string | null;
	refresh: () => void;
};

/**
 * The user's ready-to-withdraw payouts, per asset.
 *
 * Read entirely IN THE BROWSER. The backend's `/wallet/saji-balance` does the
 * same job, but reading claimables server-side means a serial fan-out of
 * contract simulations inside one request, which is the slowest part of that
 * endpoint. The browser reaches the RPC directly, so this takes the circle list
 * from `/wallet/my-circles` and does the chain reads itself.
 */
export function useSajiBalance(): SajiBalance {
	const { claimableOf } = useSavingsContract();

	const { data: myCircles } = useApi(
		useCallback(() => walletApi.myCircles(), []),
		[],
	);
	const { data: me } = useApi(useCallback(() => profileApi.show(), []), []);

	const [assets, setAssets] = useState<SajiAsset[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const address = myCircles?.stellar_address ?? me?.stellar_address ?? null;

	// `cancelled` lets a superseded run drop its result instead of overwriting a
	// newer one (the chain reads resolve out of order).
	const load = useCallback(
		async (cancelled?: () => boolean) => {
			const circles = myCircles?.circles ?? [];
			const addr = myCircles?.stellar_address ?? me?.stellar_address ?? null;
			// Yield first: this runs from an effect, and updating state
			// synchronously there triggers a cascading render.
			await Promise.resolve();
			if (cancelled?.()) return;
			if (!addr) {
				setLoading(false);
				return;
			}
			setLoading(true);
			setError(null);

			const byAsset = new Map<string, SajiAsset>();

			try {
				await Promise.all(
					circles.map(async (c) => {
						const stroops = await claimableOf(c.onchain_group_id, addr);
						if (stroops <= 0n) return;

						const entry = byAsset.get(c.asset_code) ?? {
							asset_code: c.asset_code,
							total: 0n,
							claimables: [],
						};
						entry.total += stroops;
						entry.claimables.push({
							group_id: c.group_id,
							onchain_group_id: c.onchain_group_id,
							group_name: c.group_name,
							asset_code: c.asset_code,
							amount: stroops,
						});
						byAsset.set(c.asset_code, entry);
					}),
				);
			} catch (err) {
				if (cancelled?.()) return;
				// A read failed. Reporting 0 here would tell a user with a real
				// payout that they have nothing.
				setError(
					err instanceof Error && err.message
						? err.message
						: "Couldn't reach the Stellar network to read your balance.",
				);
				setLoading(false);
				return;
			}

			if (cancelled?.()) return;
			setAssets([...byAsset.values()].filter((a) => a.total > 0n));
			setLoading(false);
		},
		[myCircles, me?.stellar_address, claimableOf],
	);

	useEffect(() => {
		let stale = false;
		// Deferred off the commit rather than called in the effect body: kicking
		// the fetch off synchronously sets state during render and cascades a
		// second pass before the first has painted.
		const timer = setTimeout(() => load(() => stale), 0);
		return () => {
			stale = true;
			clearTimeout(timer);
		};
	}, [load]);

	return {
		assets,
		loading,
		error,
		linked: !!address,
		hasWithdrawable: assets.some((a) => a.total > 0n),
		address,
		// Wrapped, NOT `refresh: load`. `load` takes an optional
		// `cancelled?: () => boolean`, and call sites pass this straight to
		// onClick — so React handed it a SyntheticEvent, `cancelled?.()` tried to
		// call it, and "Try again" threw a TypeError instead of retrying.
		// TypeScript could not catch it because
		// `(cancelled?: () => boolean) => Promise<void>` is assignable to
		// `() => void`.
		refresh: () => {
			void load();
		},
	};
}
