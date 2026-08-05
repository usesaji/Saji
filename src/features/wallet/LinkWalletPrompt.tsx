"use client";

import { useApi } from "../../lib/hooks/useApi";
import { profile as profileApi } from "../../lib/api";
import WalletConnectButton from "./WalletConnectButton";

/**
 * Onboarding nudge shown on the home/Overview screen while the user has NO
 * Stellar wallet linked.
 *
 * Linking a wallet is the gate for every money action in Saji — contribute,
 * deposit, withdraw, and being admitted to a circle on-chain. Without it a new
 * user lands on a dashboard full of actions that silently fail. This surfaces
 * the single most important next step up front and disappears the moment a
 * wallet is linked, so it never nags an already-onboarded user.
 */
export default function LinkWalletPrompt() {
	const { data: me, loading, refetch } = useApi(() => profileApi.show(), []);

	// Don't flash the banner before we know the link state, and hide it entirely
	// once a wallet is linked.
	if (loading || me?.stellar_address) return null;

	return (
		<section className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-primary-50 p-4 md:p-6">
			<div className="min-w-0">
				<h5 className="font-medium md:text-lg">Connect a wallet to get started</h5>
				<p className="mt-1 text-sm font-light text-muted-foreground">
					Link your Stellar wallet to join circles, contribute, and withdraw.
					You stay in full control of your funds — Saji never holds them.
				</p>
			</div>
			<WalletConnectButton linkedAddress={null} onChange={refetch} />
		</section>
	);
}
