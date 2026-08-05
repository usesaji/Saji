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

// Network must match the backend (STELLAR_NETWORK). Testnet for now.
export const NETWORK_PASSPHRASE = Networks.TESTNET;

let initialized = false;

/** Initialize the kit once, on first use. */
function ensureInit(): void {
	if (initialized) return;
	StellarWalletsKit.init({
		network: Networks.TESTNET,
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

/** Horizon endpoint matching NETWORK_PASSPHRASE (testnet for now). */
const HORIZON_URL = "https://horizon-testnet.stellar.org";

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
 * True if `address` already trusts `code`/`issuer` — i.e. it can hold that
 * asset. Stellar rejects payments of an issued asset to an account without a
 * trustline, so this gates the "Add trustline" affordance.
 */
export async function hasTrustline(
	address: string,
	code: string,
	issuer: string,
): Promise<boolean> {
	const res = await fetch(`${HORIZON_URL}/accounts/${address}`);
	if (!res.ok) return false;
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
	await server.submitTransaction(envelope);
}

/**
 * Withdraw `amount` (whole tokens) of an asset FROM the connected wallet TO a
 * destination address. Built, signed, and submitted entirely CLIENT-SIDE via
 * Horizon — the browser reaches the network directly, so this doesn't depend on
 * the backend reaching the RPC (which the artisan-serve worker can't — the DNS
 * wall). Non-custodial: the user's own wallet signs; we never touch the key.
 *
 * `code` is the asset code ("XLM"/"USDC"/"USDT"); `issuer` is the classic issuer
 * account for an issued asset, or null/omitted for native XLM. Returns the tx
 * hash on success.
 */
export async function withdrawToken(input: {
	from: string;
	to: string;
	amount: string | number;
	code: string;
	issuer?: string | null;
}): Promise<string> {
	const { Asset, BASE_FEE, Horizon, Operation, TransactionBuilder } =
		await import("@stellar/stellar-sdk");

	const server = new Horizon.Server(HORIZON_URL);
	const account = await server.loadAccount(input.from);

	// Native XLM vs an issued asset (USDC/USDT).
	const asset =
		input.code === "XLM" || !input.issuer
			? Asset.native()
			: new Asset(input.code, input.issuer);

	const tx = new TransactionBuilder(account, {
		fee: BASE_FEE,
		networkPassphrase: NETWORK_PASSPHRASE,
	})
		.addOperation(
			Operation.payment({
				destination: input.to,
				asset,
				amount: String(input.amount),
			}),
		)
		.setTimeout(180)
		.build();

	const signed = await signXdr(tx.toXDR());
	const envelope = TransactionBuilder.fromXDR(signed, NETWORK_PASSPHRASE);
	const res = await server.submitTransaction(envelope);
	return res.hash;
}
