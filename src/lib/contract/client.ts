"use client";

/**
 * Direct Soroban contract client for the Saji savings contract.
 *
 * Uses the generated TypeScript bindings (src/lib/contract/savings) to call the
 * contract straight from the browser — building, simulating, signing (via the
 * connected wallet), and submitting, all client-side. This bypasses the backend
 * for on-chain actions, so it isn't affected by the backend's network access.
 *
 * Contract id, passphrase and RPC all come from `stellar-network` so they can
 * never disagree — the generated bindings' baked-in `networks.testnet` is
 * deliberately NOT used, since it would pin mainnet builds to a testnet
 * contract.
 */

import { Client, PayoutOrder, LatePenalty } from "./savings/src";
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
import {
	NETWORK_PASSPHRASE,
	SAVINGS_CONTRACT_ID,
	SOROBAN_RPC_URL,
} from "../stellar-network";

export { NETWORK_PASSPHRASE };

export { PayoutOrder, LatePenalty };

/**
 * A contract client bound to the connected wallet `publicKey`. All state-changing
 * calls will prompt that wallet to sign.
 */
export function savingsClient(publicKey: string): Client {
	return new Client({
		contractId: SAVINGS_CONTRACT_ID,
		networkPassphrase: NETWORK_PASSPHRASE,
		rpcUrl: SOROBAN_RPC_URL,
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
