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

export const TOKENS: Record<TokenCode, TokenInfo> = {
	USDC: {
		code: "USDC",
		label: "USDC",
		sac:
			process.env.NEXT_PUBLIC_USDC_SAC ??
			"CCOY5JSTYMV4WN6W7WZS7JRMZXHSHKGEZQ5PCHEEAZLFQIVVFFHWCX7V",
		issuer:
			process.env.NEXT_PUBLIC_USDC_ISSUER ??
			"GCBJNSZUUPK5HSB3JLQB37OLEE4VW2WE3ZUDGAMPBTGP5LJ6AT4U7H5M",
		native: false,
	},
	USDT: {
		code: "USDT",
		label: "USDT",
		sac:
			process.env.NEXT_PUBLIC_USDT_SAC ??
			"CCM5YODOEZSDQNYO466BEH232DC2YYHCWULB6HA7PLEOKAOJIJP5GO2N",
		issuer:
			process.env.NEXT_PUBLIC_USDT_ISSUER ??
			"GCEKXEAHM3NHGG7A6VTZ5OBZDBOC3VIZF26UDX43FGMDABMJHHRLZFKD",
		native: false,
	},
	XLM: {
		code: "XLM",
		label: "XLM (native)",
		sac:
			process.env.NEXT_PUBLIC_XLM_SAC ??
			"CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
		issuer: null,
		native: true,
	},
};

export const TOKEN_LIST = Object.values(TOKENS);

/** Resolve a token by code, defaulting to USDC. */
export function tokenFor(code: string | null | undefined): TokenInfo {
	return TOKENS[(code as TokenCode) ?? "USDC"] ?? TOKENS.USDC;
}
