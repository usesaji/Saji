"use client";

import { useCallback, useState } from "react";
import { connectWallet, disconnectWallet, signXdr } from "../wallet";
import { profile as profileApi, ApiError } from "../api";
import { toast } from "../utils/toast";

/**
 * Wallet connection + signing, tied to the app.
 *
 * connect()  — opens the wallet modal, gets the public address, and persists it
 *              to the backend (users.stellar_address) so server-side chain reads
 *              /actions work.
 * sign()     — signs a backend-built unsigned XDR.
 *
 * The connected address is also mirrored to the backend on connect; callers that
 * need to know "is a wallet linked" should read profile.show().stellar_address.
 */
export function useWallet() {
	const [address, setAddress] = useState<string | null>(null);
	const [connecting, setConnecting] = useState(false);

	const connect = useCallback(async (): Promise<string | null> => {
		setConnecting(true);
		try {
			const addr = await connectWallet();
			// Prove control of `addr` before the backend will link it — sign a
			// throwaway, never-submitted challenge transaction with the SAME
			// wallet that just connected. See @/server/wallet-proof for why.
			const { unsigned_xdr } = await profileApi.walletChallenge(addr);
			const signedXdr = await signXdr(unsigned_xdr);
			await profileApi.linkWallet(addr, signedXdr);
			setAddress(addr);
			toast.success("", "Wallet linked");
			return addr;
		} catch (err) {
			// The wallet kit itself may already be connected even though linking
			// failed (e.g. the user approved the connect prompt but rejected the
			// proof-of-control signature) — disconnect it too, so the extension
			// and the app agree on "not linked" and a retry starts clean rather
			// than skipping the connect step next time.
			await disconnectWallet().catch(() => {});
			toast.error(
				err instanceof ApiError
					? err.message
					: "Could not connect your wallet.",
				"Wallet connection failed",
			);
			return null;
		} finally {
			setConnecting(false);
		}
	}, []);

	const disconnect = useCallback(async () => {
		await disconnectWallet();
		await profileApi.linkWallet(null);
		setAddress(null);
		toast.success("", "Wallet unlinked");
	}, []);

	/** Sign an unsigned XDR (throws on rejection; caller handles). */
	const sign = useCallback((unsignedXdr: string) => signXdr(unsignedXdr), []);

	return { address, connecting, connect, disconnect, sign };
}
