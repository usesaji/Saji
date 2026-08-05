"use client";

/**
 * Direct Soroban contract client for the Saji savings contract.
 *
 * Uses the generated TypeScript bindings (src/lib/contract/savings) to call the
 * contract straight from the browser — building, simulating, signing (via the
 * connected wallet), and submitting, all client-side. This bypasses the backend
 * for on-chain actions, so it isn't affected by the backend's network access.
 *
 * The contract id + default network passphrase are baked into the bindings; we
 * supply the RPC URL, the caller's public key, and a signing callback that
 * routes to Stellar Wallets Kit.
 */

import { Client, PayoutOrder, LatePenalty, networks } from "./savings/src";
import { StellarWalletsKit, Networks } from "@creit.tech/stellar-wallets-kit";

const RPC_URL =
	process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ??
	"https://soroban-testnet.stellar.org";

export const NETWORK_PASSPHRASE = Networks.TESTNET;

export { PayoutOrder, LatePenalty };

/**
 * A contract client bound to the connected wallet `publicKey`. All state-changing
 * calls will prompt that wallet to sign. The contract id + passphrase come from
 * the generated `networks.testnet` constant.
 */
export function savingsClient(publicKey: string): Client {
	return new Client({
		...networks.testnet,
		rpcUrl: RPC_URL,
		publicKey,
		// The kit returns { signedTxXdr, signerAddress } — the exact shape the
		// SDK's signer contract expects.
		signTransaction: (xdr: string) =>
			StellarWalletsKit.signTransaction(xdr, {
				networkPassphrase: NETWORK_PASSPHRASE,
				address: publicKey,
			}),
	});
}

/**
 * Assemble → sign → submit a state-changing contract call. `build` returns the
 * AssembledTransaction from a bindings method; we sign+send it and return the
 * on-chain result.
 */
export async function invoke<T>(assembled: {
	signAndSend: () => Promise<{ result: T }>;
}): Promise<T> {
	const sent = await assembled.signAndSend();
	return sent.result;
}
