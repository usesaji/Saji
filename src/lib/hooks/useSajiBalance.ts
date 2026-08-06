"use client";

import { useCallback, useEffect, useState } from "react";
import {
	wallet as walletApi,
	profile as profileApi,
} from "../api";
import { useApi } from "./useApi";
import { useSavingsContract } from "./useSavingsContract";
import { spendableBalance } from "../wallet";
import { TOKENS } from "../contract/tokens";

/**
 * One asset's withdrawable position, split by WHERE the money currently sits.
 *
 * The split matters because the two behave differently: claimable funds are
 * escrowed in the contract and cost a wallet signature per circle to release,
 * while wallet funds are already the user's and are subject to the Stellar
 * account reserve. Summing them into one number would hide both facts.
 */
export type SajiAsset = {
	asset_code: string;
	/** Escrowed in circles — needs a claim signature to release. */
	claimable_total: number;
	/** Already in the user's wallet (XLM is net of the base reserve). */
	wallet_total: number;
	/** claimable_total + wallet_total — the full withdrawable amount. */
	total: number;
	claimables: {
		group_id: number;
		onchain_group_id: number;
		group_name: string;
		asset_code: string;
		amount: string;
	}[];
};

export type SajiBalance = {
	/** Only assets with something withdrawable. */
	assets: SajiAsset[];
	loading: boolean;
	/** A Stellar address was resolvable (wallet linked). */
	linked: boolean;
	/** Anything withdrawable at all — gates the Withdraw CTA. */
	hasWithdrawable: boolean;
	address: string | null;
	refresh: () => void;
};

/**
 * The user's "Saji Balance": circle payouts owed to them plus what's already in
 * their wallet, per asset.
 *
 * Read entirely IN THE BROWSER. The backend's own `/wallet/saji-balance` does
 * the same job but its RPC reads fail from the artisan-serve worker (the DNS
 * wall) and silently return 0, so it reports an empty balance for a user who
 * actually has a payout waiting. The browser reaches the RPC fine, so this
 * takes the DB circle list from `/wallet/my-circles` and does the chain reads
 * itself. Do not "simplify" this back onto sajiBalance().
 */
export function useSajiBalance(): SajiBalance {
	const { claimableOf } = useSavingsContract();

	const { data: myCircles } = useApi(
		useCallback(() => walletApi.myCircles(), []),
		[],
	);
	const { data: me } = useApi(useCallback(() => profileApi.show(), []), []);
	// What Saji has paid vs. what's already been withdrawn — bounds the
	// "in your wallet" figure so we never count the user's own funds.
	const { data: payoutSummary } = useApi(
		useCallback(() => walletApi.payoutSummary(), []),
		[],
	);

	const [assets, setAssets] = useState<SajiAsset[]>([]);
	const [loading, setLoading] = useState(true);

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

			const byAsset = new Map<string, SajiAsset>();
			const entryFor = (code: string) => {
				const e = byAsset.get(code) ?? {
					asset_code: code,
					claimable_total: 0,
					wallet_total: 0,
					total: 0,
					claimables: [],
				};
				byAsset.set(code, e);
				return e;
			};

			await Promise.all(
				circles.map(async (c) => {
					const stroops = await claimableOf(c.onchain_group_id, addr);
					const amt = Number(stroops) / 10_000_000;
					if (amt <= 0) return;
					const entry = entryFor(c.asset_code);
					entry.claimable_total += amt;
					entry.claimables.push({
						group_id: c.group_id,
						onchain_group_id: c.onchain_group_id,
						group_name: c.group_name,
						asset_code: c.asset_code,
						amount: amt.toFixed(7),
					});
				}),
			);

			// A payout the user already claimed but hasn't sent out is still
			// withdrawable — without this, a claim that succeeded while its
			// transfer failed would leave the money invisible.
			//
			// But ONLY that: bounded by what Saji actually paid and the user
			// hasn't withdrawn (`owed`). Counting the raw wallet balance would
			// offer to send funds the user put there themselves.
			for (const a of payoutSummary?.assets ?? []) {
				const owed = Number(a.owed);
				if (owed <= 0 || !(a.asset_code in TOKENS)) continue;
				const spendable = await spendableBalance(addr, a.asset_code);
				const inWallet = Math.min(owed, spendable);
				if (inWallet > 0) entryFor(a.asset_code).wallet_total = inWallet;
			}

			if (cancelled?.()) return;
			for (const a of byAsset.values()) {
				a.total = a.claimable_total + a.wallet_total;
			}
			setAssets([...byAsset.values()].filter((a) => a.total > 0));
			setLoading(false);
		},
		[myCircles, me?.stellar_address, claimableOf, payoutSummary],
	);

	useEffect(() => {
		let stale = false;
		load(() => stale);
		return () => {
			stale = true;
		};
	}, [load]);

	return {
		assets,
		loading,
		linked: !!address,
		hasWithdrawable: assets.some((a) => a.total > 0),
		address,
		refresh: load,
	};
}
