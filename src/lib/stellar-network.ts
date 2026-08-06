/**
 * The ONE place that decides which Stellar network the app talks to.
 *
 * Every network-dependent value — passphrase, Horizon, Soroban RPC, contract id,
 * asset issuers — is derived here from `NEXT_PUBLIC_STELLAR_NETWORK`. Scattering
 * these across modules is how an app ends up half-configured: RPC pointed at
 * mainnet while the contract id and passphrase are still testnet, which fails by
 * silently reading zero balances rather than by erroring.
 *
 * On PUBLIC (mainnet) every value is REQUIRED and there are no fallbacks. A
 * missing variable throws at module load, because the alternative — quietly
 * falling back to testnet, or to a test token the team can mint — means users
 * transacting worthless assets while the UI calls them dollars.
 */

export type StellarNetwork = "PUBLIC" | "TESTNET";

export const NETWORK: StellarNetwork =
	process.env.NEXT_PUBLIC_STELLAR_NETWORK === "PUBLIC" ? "PUBLIC" : "TESTNET";

export const IS_MAINNET = NETWORK === "PUBLIC";

/** Read a var that is mandatory on mainnet but may fall back on testnet. */
function required(name: string, testnetFallback: string): string {
	const value = process.env[name] ?? "";
	if (value) return value;
	if (IS_MAINNET) {
		throw new Error(
			`${name} must be set when NEXT_PUBLIC_STELLAR_NETWORK=PUBLIC. ` +
				`Refusing to fall back to a testnet value on mainnet.`,
		);
	}
	return testnetFallback;
}

export const NETWORK_PASSPHRASE = IS_MAINNET
	? "Public Global Stellar Network ; September 2015"
	: "Test SDF Network ; September 2015";

export const HORIZON_URL = required(
	"NEXT_PUBLIC_HORIZON_URL",
	"https://horizon-testnet.stellar.org",
);

export const SOROBAN_RPC_URL = required(
	"NEXT_PUBLIC_SOROBAN_RPC_URL",
	"https://soroban-testnet.stellar.org",
);

/** The deployed Saji savings contract for this network. */
export const SAVINGS_CONTRACT_ID = required(
	"NEXT_PUBLIC_SAVINGS_CONTRACT_ID",
	"CCJVEADU3PCABQUSWCQD473WC3ZXHIO2TJ2ENWNGFBE4ZOJ44YBZG3KK",
);
