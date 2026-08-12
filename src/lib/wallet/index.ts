"use client";

/**
 * Stellar wallet integration (Stellar Wallets Kit).
 *
 * Non-custodial: the kit talks to the user's browser wallet (Freighter, Albedo,
 * xBull, Lobstr, Hana…). We only ever get the PUBLIC address and ask the wallet
 * to sign XDR the backend built — we never see a secret key.
 *
 * The kit uses browser-only APIs, so init is lazy and client-side.
 */

import {
	StellarWalletsKit,
	Networks,
} from "@creit.tech/stellar-wallets-kit";
import { FreighterModule } from "@creit.tech/stellar-wallets-kit/modules/freighter";
import { AlbedoModule } from "@creit.tech/stellar-wallets-kit/modules/albedo";
import { xBullModule } from "@creit.tech/stellar-wallets-kit/modules/xbull";
import { LobstrModule } from "@creit.tech/stellar-wallets-kit/modules/lobstr";
import { HanaModule } from "@creit.tech/stellar-wallets-kit/modules/hana";
import {
	HORIZON_URL as NETWORK_HORIZON_URL,
	IS_MAINNET,
	NETWORK_PASSPHRASE as NETWORK_PASSPHRASE_FOR_NETWORK,
} from "../stellar-network";

// Network comes from NEXT_PUBLIC_STELLAR_NETWORK (see lib/stellar-network).
// This signs every payment and trustline, so it MUST match the network the
// user's wallet is on — a mismatch produces signatures the network rejects.
export const NETWORK_PASSPHRASE = NETWORK_PASSPHRASE_FOR_NETWORK;

let initialized = false;

/** Initialize the kit once, on first use. */
function ensureInit(): void {
	if (initialized) return;
	StellarWalletsKit.init({
		network: IS_MAINNET ? Networks.PUBLIC : Networks.TESTNET,
		modules: [
			new FreighterModule(),
			new AlbedoModule(),
			new xBullModule(),
			new LobstrModule(),
			new HanaModule(),
		],
	});
	initialized = true;
}

/**
 * Open the wallet-picker modal and connect. Returns the chosen public address.
 * The modal handles wallet selection + connection in one step.
 */
export async function connectWallet(): Promise<string> {
	ensureInit();
	const { address } = await StellarWalletsKit.authModal();
	return address;
}

/** The currently connected address, or null if none. */
export async function currentAddress(): Promise<string | null> {
	ensureInit();
	try {
		const { address } = await StellarWalletsKit.getAddress();
		return address || null;
	} catch {
		return null;
	}
}

/** Disconnect the active wallet. */
export async function disconnectWallet(): Promise<void> {
	ensureInit();
	try {
		await StellarWalletsKit.disconnect();
	} catch {
		/* no-op */
	}
}

/**
 * Sign a backend-built unsigned XDR with the connected wallet and return the
 * signed envelope XDR (base64). The caller posts this back to a submit endpoint.
 */
export async function signXdr(unsignedXdr: string): Promise<string> {
	ensureInit();
	const { signedTxXdr } = await StellarWalletsKit.signTransaction(unsignedXdr, {
		networkPassphrase: NETWORK_PASSPHRASE,
	});
	return signedTxXdr;
}

/** Horizon endpoint matching NETWORK_PASSPHRASE (see lib/stellar-network). */
const HORIZON_URL = NETWORK_HORIZON_URL;

/** A wallet's balance per asset code, read from Horizon in the BROWSER. */
export type WalletBalances = Record<string, number>;

/**
 * Read an account's balances (native XLM + issued assets) straight from Horizon
 * — client-side, so it works even though the backend web worker can't reach the
 * RPC (the DNS wall). Returns { XLM: n, USDC: n, ... }; missing assets are 0.
 * Returns {} if the account isn't found/funded.
 */
export async function walletBalances(address: string): Promise<WalletBalances> {
	try {
		const res = await fetch(`${HORIZON_URL}/accounts/${address}`);
		if (!res.ok) return {};
		const account: {
			balances?: {
				balance: string;
				asset_type: string;
				asset_code?: string;
			}[];
		} = await res.json();
		const out: WalletBalances = {};
		for (const b of account.balances ?? []) {
			const code = b.asset_type === "native" ? "XLM" : b.asset_code;
			if (code) out[code] = Number(b.balance);
		}
		return out;
	} catch {
		return {};
	}
}

/**
 * Turn a Horizon submission failure into something a user can act on.
 *
 * The SDK's error message for a rejected tx is just "Transaction submission
 * failed. Server responded: 400 Bad Request" — the real cause lives in
 * `response.data.extras.result_codes`, which it doesn't surface. This digs that
 * out and maps the codes we can actually hit, falling back to the raw codes so
 * an unmapped failure is still diagnosable instead of opaque.
 */
function describeSubmitError(err: unknown, ctx: { code: string }): Error {
	const extras = (
		err as {
			response?: {
				data?: {
					extras?: {
						result_codes?: { transaction?: string; operations?: string[] };
					};
				};
			};
		}
	)?.response?.data?.extras;

	const tx = extras?.result_codes?.transaction;
	const ops = extras?.result_codes?.operations ?? [];
	if (!tx && ops.length === 0) {
		return err instanceof Error ? err : new Error(String(err));
	}

	const all = [tx, ...ops].filter(Boolean).join(" ");
	const msg = (() => {
		if (/op_underfunded|tx_insufficient_balance/.test(all))
			return `Not enough ${ctx.code} in your wallet to cover this amount plus the network fee.`;
		if (/op_no_trust|op_no_issuer/.test(all))
			return `The destination can't receive ${ctx.code} — it needs a ${ctx.code} trustline first.`;
		if (/op_no_destination/.test(all))
			return "That destination account doesn't exist on this network yet.";
		if (/tx_insufficient_fee/.test(all))
			return "The network fee was too low — the network is busy. Try again.";
		if (/tx_bad_seq/.test(all))
			return "Your wallet submitted an out-of-date transaction. Try again.";
		if (/tx_too_late|tx_bad_auth/.test(all))
			return "The signed transaction expired or was rejected. Try again.";
		if (/op_line_full/.test(all))
			return `The destination can't hold any more ${ctx.code}.`;
		return `The network rejected this transaction (${all}).`;
	})();

	return new Error(msg);
}


/**
 * True if `address` already trusts `code`/`issuer` — i.e. it can hold that
 * asset. Stellar rejects payments of an issued asset to an account without a
 * trustline, so this gates the "Add trustline" affordance.
 *
 * THROWS if Horizon can't be reached: a failed read is NOT evidence of a
 * missing trustline. This used to
 * `return false` on any non-OK response, so a Horizon hiccup made the withdraw
 * screen state — confidently, and about an account the user may not even
 * control — that the destination could not receive the asset. That blocks a
 * perfectly good withdrawal and sends the user off to add a trustline that is
 * very likely already there. Callers must surface the network error instead.
 */
export async function hasTrustline(
	address: string,
	code: string,
	issuer: string,
): Promise<boolean> {
	const res = await fetch(`${HORIZON_URL}/accounts/${address}`);
	// An account that does not exist holds no trustlines. That is a real answer
	// from the network, not a failed read.
	if (res.status === 404) return false;
	if (!res.ok) {
		throw new Error(
			`Couldn't check that destination on the network (Horizon ${res.status}). Please try again.`,
		);
	}
	const account: { balances?: { asset_code?: string; asset_issuer?: string }[] } =
		await res.json();
	return (account.balances ?? []).some(
		(b) => b.asset_code === code && b.asset_issuer === issuer,
	);
}

/**
 * Open a trustline so the connected wallet can hold an issued asset.
 *
 * Only the account's OWN key may authorize this, so it must be signed by the
 * user's wallet — no backend or script can do it on their behalf. We build the
 * change_trust tx client-side, have the wallet sign it, and submit to Horizon.
 *
 * Resolves silently if the trustline already exists.
 */
export async function addTrustline(
	address: string,
	code: string,
	issuer: string,
): Promise<void> {
	if (await hasTrustline(address, code, issuer)) return;

	// Imported lazily: the SDK is heavy and only needed for this action.
	const { Asset, BASE_FEE, Horizon, Operation, TransactionBuilder } =
		await import("@stellar/stellar-sdk");

	const server = new Horizon.Server(HORIZON_URL);
	const account = await server.loadAccount(address);

	const tx = new TransactionBuilder(account, {
		fee: BASE_FEE,
		networkPassphrase: NETWORK_PASSPHRASE,
	})
		.addOperation(Operation.changeTrust({ asset: new Asset(code, issuer) }))
		.setTimeout(180)
		.build();

	const signed = await signXdr(tx.toXDR());

	const envelope = TransactionBuilder.fromXDR(signed, NETWORK_PASSPHRASE);
	try {
		await server.submitTransaction(envelope);
	} catch (err) {
		throw describeSubmitError(err, { code });
	}
}

