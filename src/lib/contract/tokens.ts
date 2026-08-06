/**
 * Supported pool tokens for savings groups — a group saves in exactly ONE of
 * these (chosen at creation). Each maps its asset code to the token's Stellar
 * Asset Contract (SAC) address on the active network, which is what the savings
 * contract's `create_group` takes as its `token` argument.
 *
 * Testnet SAC addresses (derived via `stellar contract id asset`):
 *   XLM  = native SAC
 *   USDC = self-issued test asset, issuer GCBJNSZU…AT4U7H5M
 *   USDT = self-issued test asset, issuer GCEKXEAH…JHHRLZFKD
 *
 * USDC/USDT are issued by keys WE control on testnet so they can be minted on
 * demand (`backend/scripts/fund-testnet.sh`). No public faucet exists for a
 * testnet USDT, and the SDF/Circle USDC only arrives via the SEP-24 anchor
 * flow — both too slow for everyday testing. Swap these for the real
 * Circle-issued addresses via env before mainnet.
 *
 * Members contributing to a group must hold a trustline for that group's token
 * (XLM needs none — it's native). Override any address via env for other nets.
 */

import { IS_MAINNET } from "../stellar-network";

export type TokenCode = "USDC" | "USDT" | "XLM";

export type TokenInfo = {
	code: TokenCode;
	label: string;
	/** Stellar Asset Contract address used as the on-chain pool token. */
	sac: string;
	/**
	 * Classic issuer account (G…) for this asset. Needed to open a trustline —
	 * the SAC address alone can't express `change_trust`. Null for native XLM.
	 */
	issuer: string | null;
	/** Native assets (XLM) need no trustline; issued assets do. */
	native: boolean;
};

/**
 * Read a token address that is MANDATORY on mainnet.
 *
 * The testnet fallbacks below are self-issued assets minted by keys we control.
 * Falling back to one on mainnet would show a user "USDC" while they actually
 * hold a worthless token — so on PUBLIC a missing variable throws instead.
 */
function tokenAddress(name: string, testnetFallback: string): string {
	const value = process.env[name] ?? "";
	if (value) return value;
	if (IS_MAINNET) {
		throw new Error(
			`${name} must be set when NEXT_PUBLIC_STELLAR_NETWORK=PUBLIC. ` +
				`The testnet default is a self-issued test asset and must never be ` +
				`used as real money.`,
		);
	}
	return testnetFallback;
}

export const TOKENS: Record<TokenCode, TokenInfo> = {
	USDC: {
		code: "USDC",
		label: "USDC",
		sac: tokenAddress(
			"NEXT_PUBLIC_USDC_SAC",
			"CCOY5JSTYMV4WN6W7WZS7JRMZXHSHKGEZQ5PCHEEAZLFQIVVFFHWCX7V",
		),
		issuer: tokenAddress(
			"NEXT_PUBLIC_USDC_ISSUER",
			"GCBJNSZUUPK5HSB3JLQB37OLEE4VW2WE3ZUDGAMPBTGP5LJ6AT4U7H5M",
		),
		native: false,
	},
	USDT: {
		code: "USDT",
		label: "USDT",
		sac: tokenAddress(
			"NEXT_PUBLIC_USDT_SAC",
			"CCM5YODOEZSDQNYO466BEH232DC2YYHCWULB6HA7PLEOKAOJIJP5GO2N",
		),
		issuer: tokenAddress(
			"NEXT_PUBLIC_USDT_ISSUER",
			"GCEKXEAHM3NHGG7A6VTZ5OBZDBOC3VIZF26UDX43FGMDABMJHHRLZFKD",
		),
		native: false,
	},
	XLM: {
		code: "XLM",
		label: "XLM (native)",
		sac: tokenAddress(
			"NEXT_PUBLIC_XLM_SAC",
			"CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
		),
		issuer: null,
		native: true,
	},
};

export const TOKEN_LIST = Object.values(TOKENS);

/**
 * Resolve a token by code, or null if it isn't one we support.
 *
 * Deliberately does NOT fall back to USDC. Defaulting an unknown code would
 * hand back USDC's issuer while the UI still showed the original code, and that
 * issuer goes straight into a payment — building a transfer of a different asset
 * than the one named on screen. Callers must handle null and refuse to proceed.
 */
export function tokenFor(code: string | null | undefined): TokenInfo | null {
	if (!code) return null;
	return TOKENS[code as TokenCode] ?? null;
}

/** Like `tokenFor`, but throws — for paths where an unknown asset is a bug. */
export function requireToken(code: string | null | undefined): TokenInfo {
	const token = tokenFor(code);
	if (!token) {
		throw new Error(
			`Unsupported asset "${code}". Saji supports ${Object.keys(TOKENS).join(", ")}.`,
		);
	}
	return token;
}
