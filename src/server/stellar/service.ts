/**
 * Server-side Stellar access — the replacement for Laravel's `StellarService`.
 *
 * The PHP version shelled out to the `stellar` CLI binary (Symfony Process) for
 * every read and every unsigned-tx build. That is what forced a VPS, a Rust
 * toolchain, and `exec()` to be re-enabled in PHP. Here the JS SDK talks to
 * Soroban RPC directly in-process, so this runs on any serverless host with no
 * binary, no subprocess, and no PATH.
 *
 * What did NOT change is the trust model. Saji is non-custodial: the backend
 * never holds a user's secret key and never signs on their behalf. Anything
 * that moves a user's money is BUILT here and returned as unsigned XDR for the
 * user's wallet to sign. The single exception is `trigger_payout`, which the
 * contract lets the service account call because it can only ever pay the
 * rules-determined recipient — see `triggerPayout` below.
 */

import {
	Address,
	Contract,
	Keypair,
	Networks,
	TransactionBuilder,
	rpc,
	nativeToScVal,
	scValToNative,
	xdr,
} from "@stellar/stellar-sdk";

// ---------------------------------------------------------------------------
// Network configuration
//
// Server-side twin of `src/lib/stellar-network.ts`. Kept separate because these
// read non-public env vars, but it follows the same rule: on mainnet every
// value is REQUIRED and there is no testnet fallback. Silently falling back
// means users transacting worthless assets while the UI calls them dollars.
// ---------------------------------------------------------------------------

export const IS_MAINNET = process.env.STELLAR_NETWORK === "public";

function required(name: string, testnetFallback: string): string {
	const value = process.env[name] ?? "";
	if (value) return value;
	if (IS_MAINNET) {
		throw new Error(
			`${name} must be set when STELLAR_NETWORK=public. ` +
				`Refusing to fall back to a testnet value on mainnet.`,
		);
	}
	return testnetFallback;
}

export const NETWORK_PASSPHRASE = IS_MAINNET
	? Networks.PUBLIC
	: Networks.TESTNET;

export const RPC_URL = required(
	"STELLAR_RPC_URL",
	"https://soroban-testnet.stellar.org",
);

export const CONTRACT_ID = process.env.STELLAR_CONTRACT_ID ?? "";

/**
 * A funded account used only as the source for read simulations. Reads never
 * submit, so this key is never spent and never needs to sign — but Soroban
 * still requires a valid source account on the envelope.
 */
export const READ_SOURCE = process.env.STELLAR_READ_SOURCE ?? "";

/** Stellar uses 7 decimal places; on-chain amounts are integers of 1e-7. */
export const STROOP_SCALE = 10_000_000n;

export const server = new rpc.Server(RPC_URL, {
	allowHttp: RPC_URL.startsWith("http://"),
});

function assertConfigured(): void {
	if (!CONTRACT_ID) {
		throw new Error(
			"STELLAR_CONTRACT_ID is not set; deploy the contract first.",
		);
	}
}

// ---------------------------------------------------------------------------
// Amount conversion
//
// Decimal strings <-> on-chain integer stroops. Deliberately string/BigInt
// based: `parseFloat` cannot represent 7-dp decimals exactly, and the error
// lands directly in user balances.
// ---------------------------------------------------------------------------

/** "12.5" -> 125000000n */
export function toStroops(amount: string | number): bigint {
	const text = typeof amount === "number" ? amount.toFixed(7) : amount.trim();

	if (!/^-?\d+(\.\d+)?$/.test(text)) {
		throw new Error(`Invalid decimal amount: ${amount}`);
	}

	const negative = text.startsWith("-");
	const [whole, fraction = ""] = text.replace("-", "").split(".");

	if (fraction.length > 7) {
		throw new Error(
			`Amount ${amount} has more than 7 decimal places; Stellar cannot represent it.`,
		);
	}

	const padded = fraction.padEnd(7, "0");
	const value = BigInt(whole) * STROOP_SCALE + BigInt(padded);

	return negative ? -value : value;
}

/** 125000000n -> "12.5000000" */
export function fromStroops(stroops: bigint | number | string): string {
	const value = BigInt(stroops);
	const negative = value < 0n;
	const abs = negative ? -value : value;

	const whole = abs / STROOP_SCALE;
	const fraction = (abs % STROOP_SCALE).toString().padStart(7, "0");

	return `${negative ? "-" : ""}${whole}.${fraction}`;
}

// ---------------------------------------------------------------------------
// Core invocation helpers
// ---------------------------------------------------------------------------

/**
 * Simulate a contract call and return its decoded native value.
 *
 * Read-only: nothing is signed or submitted, so views never need a funded
 * signer. Mirrors the PHP `readScalar` / `readJson` pair — one function here,
 * because `scValToNative` handles scalars and structs alike.
 */
async function simulate<T>(
	method: string,
	args: xdr.ScVal[],
	contractId = CONTRACT_ID,
): Promise<T> {
	assertConfigured();

	if (!READ_SOURCE) {
		throw new Error(
			"STELLAR_READ_SOURCE is not set; contract reads need a source account.",
		);
	}

	const account = await server.getAccount(READ_SOURCE);
	const contract = new Contract(contractId);

	const tx = new TransactionBuilder(account, {
		fee: "100",
		networkPassphrase: NETWORK_PASSPHRASE,
	})
		.addOperation(contract.call(method, ...args))
		.setTimeout(30)
		.build();

	const sim = await server.simulateTransaction(tx);

	if (rpc.Api.isSimulationError(sim)) {
		throw new Error(`Soroban simulate ${method} failed: ${sim.error}`);
	}

	if (!sim.result?.retval) {
		throw new Error(`Soroban simulate ${method} returned no value.`);
	}

	return scValToNative(sim.result.retval) as T;
}

/**
 * Build an UNSIGNED, simulation-prepared transaction and return base64 XDR.
 *
 * This is the non-custodial path: the user's wallet signs client-side and
 * submits. The equivalent of the CLI's `--build-only`, minus the subprocess.
 */
async function buildUnsigned(
	sourceAccount: string,
	method: string,
	args: xdr.ScVal[],
	contractId = CONTRACT_ID,
): Promise<string> {
	assertConfigured();

	const account = await server.getAccount(sourceAccount);
	const contract = new Contract(contractId);

	const tx = new TransactionBuilder(account, {
		fee: "1000000",
		networkPassphrase: NETWORK_PASSPHRASE,
	})
		.addOperation(contract.call(method, ...args))
		.setTimeout(300)
		.build();

	// `prepareTransaction` simulates and folds in the Soroban resource
	// footprint and fees. Without it the wallet signs a tx the network rejects.
	const prepared = await server.prepareTransaction(tx);

	return prepared.toXDR();
}

// ---------------------------------------------------------------------------
// Argument builders — keep ScVal type choices in one place.
//
// These types must match the contract's parameter types exactly. A u64 passed
// where the contract expects i128 fails at simulation with an opaque error, so
// they are centralised rather than inlined at each call site.
// ---------------------------------------------------------------------------

const u64 = (value: number | bigint) =>
	nativeToScVal(BigInt(value), { type: "u64" });

const u32 = (value: number) => nativeToScVal(value, { type: "u32" });

const i128 = (value: bigint) => nativeToScVal(value, { type: "i128" });

const addr = (value: string) => new Address(value).toScVal();

// ---------------------------------------------------------------------------
// Reads — dashboard and indexer
// ---------------------------------------------------------------------------

/** Current pooled balance for a group, in stroops. */
export async function getPool(groupId: number | bigint): Promise<bigint> {
	return BigInt(await simulate<bigint>("get_pool", [u64(groupId)]));
}

/** The full on-chain group record. Shape follows the contract's Group struct. */
export async function getGroup(groupId: number | bigint): Promise<OnchainGroup> {
	return simulate<OnchainGroup>("get_group", [u64(groupId)]);
}

/** Member addresses, in rotation order. */
export async function getMembers(
	groupId: number | bigint,
): Promise<string[]> {
	return simulate<string[]>("get_members", [u64(groupId)]);
}

/** Whether `member` has paid for `cycle`. */
export async function hasContributed(
	groupId: number | bigint,
	member: string,
	cycle: number,
): Promise<boolean> {
	return simulate<boolean>("has_contributed", [
		u64(groupId),
		addr(member),
		u32(cycle),
	]);
}

/**
 * A token balance for an account, in stroops.
 *
 * Defaults to the configured USDC SAC. Note this reads the TOKEN contract, not
 * the savings contract, so it works even when the savings contract is unset.
 */
export async function getTokenBalance(
	account: string,
	token = process.env.STELLAR_USDC_SAC ?? "",
): Promise<bigint> {
	if (!token) {
		throw new Error("No token address configured for balance lookup.");
	}

	return BigInt(await simulate<bigint>("balance", [addr(account)], token));
}

/**
 * What `member` can currently claim from a group's escrow, in stroops.
 *
 * Non-custodial: these funds sit in the CONTRACT, not with Saji. Returns 0 when
 * the contract has nothing recorded for this member.
 */
export async function claimableOf(
	groupId: number | bigint,
	member: string,
): Promise<bigint> {
	const value = await simulate<bigint | null>("claimable_of", [
		u64(groupId),
		addr(member),
	]);

	return value === null ? 0n : BigInt(value);
}

/**
 * Every asset the app supports, mapped to its token contract (SAC) address.
 *
 * Assets with no configured SAC are OMITTED rather than defaulted — reading a
 * balance against the wrong token contract returns a confidently wrong number.
 */
export function tokenSacs(): Record<string, string> {
	const configured: Record<string, string | undefined> = {
		XLM: process.env.STELLAR_XLM_SAC,
		USDC: process.env.STELLAR_USDC_SAC,
		USDT: process.env.STELLAR_USDT_SAC,
	};

	return Object.fromEntries(
		Object.entries(configured).filter(
			(entry): entry is [string, string] => Boolean(entry[1]),
		),
	);
}

/**
 * Non-blocking status check for a tx hash: SUCCESS / FAILED / NOT_FOUND.
 * NOT_FOUND means still pending or unknown — the indexer treats it as pending.
 */
export async function getTransactionStatus(hash: string): Promise<string> {
	try {
		const result = await server.getTransaction(hash);
		return result.status ?? "NOT_FOUND";
	} catch {
		return "NOT_FOUND";
	}
}

// ---------------------------------------------------------------------------
// Unsigned transaction builders — the user's wallet signs these
// ---------------------------------------------------------------------------

export interface CreateGroupParams {
	organizer: string;
	token: string;
	contributionAmount: bigint;
	cycleLengthDays: number;
	feeBps: number;
	lateFeeBps: number;
	gracePeriodHours: number;
	payoutOrder: number;
	latePenalty: number;
}

/** Unsigned `create_group`, for the organizer's wallet to sign. */
export async function buildCreateGroupTx(
	params: CreateGroupParams,
): Promise<string> {
	return buildUnsigned(params.organizer, "create_group", [
		addr(params.organizer),
		addr(params.token),
		i128(params.contributionAmount),
		u32(params.cycleLengthDays),
		u32(params.feeBps),
		u32(params.lateFeeBps),
		u32(params.gracePeriodHours),
		u32(params.payoutOrder),
		u32(params.latePenalty),
	]);
}

/**
 * Unsigned `join_group` — admits `member` to a group.
 *
 * The ORGANIZER signs this, not the member: admitting someone is the
 * organizer's authority, and the member being admitted is a separate argument.
 * Passing the member as the source account would build a transaction the
 * contract rejects.
 */
export async function buildJoinGroupTx(
	organizer: string,
	groupId: number | bigint,
	member: string,
): Promise<string> {
	return buildUnsigned(organizer, "join_group", [u64(groupId), addr(member)]);
}

/**
 * Unsigned `start_cycle` — locks the rotation and starts cycle 0.
 * Organizer signs.
 */
export async function buildStartCycleTx(
	organizer: string,
	groupId: number | bigint,
): Promise<string> {
	return buildUnsigned(organizer, "start_cycle", [u64(groupId)]);
}

/**
 * Unsigned `set_payout_order` — freezes the rotation order on-chain.
 * Organizer signs.
 */
export async function buildSetPayoutOrderTx(
	organizer: string,
	groupId: number | bigint,
	members: string[],
): Promise<string> {
	return buildUnsigned(organizer, "set_payout_order", [
		u64(groupId),
		nativeToScVal(members.map((m) => new Address(m))),
	]);
}

/** Unsigned `contribute`, for the contributing member's wallet to sign. */
export async function buildContributeTx(
	member: string,
	groupId: number | bigint,
): Promise<string> {
	return buildUnsigned(member, "contribute", [u64(groupId), addr(member)]);
}

/**
 * Unsigned token transfer — the Wallet "Withdraw" action.
 *
 * A withdrawal is a plain token transfer against the TOKEN contract, so no
 * savings-contract id is needed. The backend only assembles it; the user's
 * wallet signs and submits.
 */
export async function buildWithdrawTx(
	from: string,
	to: string,
	amount: bigint,
	token = process.env.STELLAR_USDC_SAC ?? "",
): Promise<string> {
	if (!token) {
		throw new Error("No token address configured for withdrawal.");
	}
	if (amount <= 0n) {
		throw new Error("Withdrawal amount must be positive.");
	}

	return buildUnsigned(
		from,
		"transfer",
		[addr(from), addr(to), i128(amount)],
		token,
	);
}

// ---------------------------------------------------------------------------
// Service-signed action
// ---------------------------------------------------------------------------

/**
 * Trigger the current cycle's payout, signed by the service account.
 *
 * This is the ONLY call the backend signs itself. It is safe because
 * `trigger_payout` takes no authority from any user — the contract pays the
 * rules-determined recipient and nobody else, so a compromised backend cannot
 * redirect funds. It still cannot run without STELLAR_SERVICE_SECRET; the
 * backend must never fabricate authority it has not been given.
 *
 * Returns the submitted transaction hash.
 */
export async function triggerPayout(
	groupId: number | bigint,
): Promise<string> {
	assertConfigured();

	const secret = process.env.STELLAR_SERVICE_SECRET ?? "";
	if (!secret) {
		throw new Error(
			"STELLAR_SERVICE_SECRET is not configured; cannot trigger payout.",
		);
	}

	const keypair = Keypair.fromSecret(secret);
	const account = await server.getAccount(keypair.publicKey());
	const contract = new Contract(CONTRACT_ID);

	const tx = new TransactionBuilder(account, {
		fee: "1000000",
		networkPassphrase: NETWORK_PASSPHRASE,
	})
		.addOperation(contract.call("trigger_payout", u64(groupId)))
		.setTimeout(300)
		.build();

	const prepared = await server.prepareTransaction(tx);
	prepared.sign(keypair);

	const sent = await server.sendTransaction(prepared);

	if (sent.status === "ERROR") {
		throw new Error(
			`trigger_payout submission failed: ${JSON.stringify(sent.errorResult)}`,
		);
	}

	return sent.hash;
}

/**
 * Submit an already-signed transaction envelope and return its hash.
 *
 * Used by the routes that accept signed XDR back from the frontend. The
 * envelope is signed by the USER's wallet — this only relays it.
 */
export async function submitSignedXdr(signedXdr: string): Promise<string> {
	const tx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
	const sent = await server.sendTransaction(tx);

	if (sent.status === "ERROR") {
		throw new Error(
			`Transaction submission failed: ${JSON.stringify(sent.errorResult)}`,
		);
	}

	return sent.hash;
}

/** Explorer link for a tx hash, matching the network in use. */
export function explorerUrl(hash: string): string {
	const network = IS_MAINNET ? "public" : "testnet";
	return `https://stellar.expert/explorer/${network}/tx/${hash}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The contract's Group struct, as decoded by `scValToNative`. */
export interface OnchainGroup {
	organizer: string;
	token: string;
	contribution_amount: bigint;
	cycle_length_days: number;
	fee_bps: number;
	current_cycle: number;
	status: number;
	members: string[];
	next_recipient?: string;
	next_payout_at?: bigint;
}
