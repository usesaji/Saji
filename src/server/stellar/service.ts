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

/**
 * Every value below has a `NEXT_PUBLIC_` twin that the browser reads from
 * `src/lib/stellar-network.ts`. Both files used to claim, in their own opening
 * comment, to be the single place that decides — which meant four values
 * configured twice, under two names, with nothing checking that they agreed.
 *
 * They are the same process now (the API is route handlers in this app, not a
 * separate Laravel deployment), and none of these values is a secret, so the
 * public twin is the authority and the server-only name is an optional
 * override. `agree()` turns the drift that used to be a silent, hour-long
 * debugging session — the browser signing against a contract that holds no
 * groups, surfacing as `#1 GroupNotFound` — into a refusal to start.
 */
function agree(
	serverName: string,
	publicName: string,
	/**
	 * The network selector alone is compared case-insensitively: the two halves
	 * of the codebase spell it differently by existing convention
	 * (`STELLAR_NETWORK=testnet`, `NEXT_PUBLIC_STELLAR_NETWORK=TESTNET`) and both
	 * are read through their own case-normalising comparison. Contract ids and
	 * URLs are compared exactly — for those, any difference is a real one.
	 */
	ignoreCase = false,
): string {
	const serverValue = (process.env[serverName] ?? "").trim();
	const publicValue = (process.env[publicName] ?? "").trim();

	const differs = ignoreCase
		? serverValue.toLowerCase() !== publicValue.toLowerCase()
		: serverValue !== publicValue;

	if (serverValue && publicValue && differs) {
		throw new Error(
			`${serverName} and ${publicName} disagree (${serverValue} vs ${publicValue}). ` +
				`These must name the same network/contract: the browser signs against the ` +
				`public value and the server reads the other, so a mismatch means writes and ` +
				`reads land in different places. Unset one of them.`,
		);
	}

	return serverValue || publicValue;
}

export const IS_MAINNET =
	agree(
		"STELLAR_NETWORK",
		"NEXT_PUBLIC_STELLAR_NETWORK",
		true,
	).toLowerCase() === "public";

function required(
	serverName: string,
	publicName: string,
	testnetFallback: string,
): string {
	const value = agree(serverName, publicName);
	if (value) return value;
	if (IS_MAINNET) {
		throw new Error(
			`${serverName} (or ${publicName}) must be set on mainnet. ` +
				`Refusing to fall back to a testnet value.`,
		);
	}
	return testnetFallback;
}

export const NETWORK_PASSPHRASE = IS_MAINNET
	? Networks.PUBLIC
	: Networks.TESTNET;

export const RPC_URL = required(
	"STELLAR_RPC_URL",
	"NEXT_PUBLIC_SOROBAN_RPC_URL",
	"https://soroban-testnet.stellar.org",
);

export const CONTRACT_ID = agree(
	"STELLAR_CONTRACT_ID",
	"NEXT_PUBLIC_SAVINGS_CONTRACT_ID",
);

/**
 * The deployed challenge (public savings) contract. A SEPARATE contract from
 * `CONTRACT_ID` (savings/rotating circles): each contract has one token
 * balance, so this must never be conflated with the savings contract id.
 */
export const CHALLENGE_CONTRACT_ID = agree(
	"STELLAR_CHALLENGE_CONTRACT_ID",
	"NEXT_PUBLIC_CHALLENGE_CONTRACT_ID",
);

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

function assertChallengeConfigured(): void {
	if (!CHALLENGE_CONTRACT_ID) {
		throw new Error(
			"STELLAR_CHALLENGE_CONTRACT_ID is not set; deploy the challenge contract first.",
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
	if (!contractId) {
		throw new Error(
			"No contract id configured for this read; deploy the contract first.",
		);
	}

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

// NOTE: this module used to also export a set of unsigned-XDR builders
// (`buildCreateGroupTx`, `buildContributeTx`, `buildJoinGroupTx`,
// `buildSetPayoutOrderTx`, `buildStartCycleTx`, `buildWithdrawTx`) plus a
// `submitSignedXdr` relay, backed by a shared `buildUnsigned` helper.
//
// They are gone deliberately. The browser builds and signs every one of those
// calls itself through the generated bindings in `src/lib/contract/*`, and
// nothing ever read the XDR these produced — the routes paid two RPC round
// trips per request to compute a string the client discarded. Being a second,
// unexercised encoding of the same contract interface, they had also drifted
// (create_group passed days/hours as u32 where the contract takes seconds as
// u64), which is precisely the failure mode that a duplicate interface invites.
//
// If a server-built XDR path is ever genuinely needed, add it back with a test
// that exercises it — an unexercised builder is worse than no builder.

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

const addr = (value: string) => new Address(value).toScVal();

// There was an `i128` helper here too. It is gone with the unsigned-tx builders
// that were its only callers — no read this module performs takes an i128.
// `scripts/check-call-sites.mjs` still knows the mapping, so restoring it (for a
// `deposit`/`transfer`-shaped call) needs no change there.

// ---------------------------------------------------------------------------
// Reads — dashboard and indexer
// ---------------------------------------------------------------------------

/** Current pooled balance for a group, in stroops. */
export async function getPool(groupId: number | bigint): Promise<bigint> {
	return BigInt(await simulate<bigint>("get_pool", [u64(groupId)]));
}

/** The full on-chain group record. Shape follows the contract's Group struct. */
export async function getGroup(
	groupId: number | bigint,
): Promise<OnchainGroup> {
	return simulate<OnchainGroup>("get_group", [u64(groupId)]);
}

/**
 * The group's current cycle index.
 *
 * Lives under its own storage key, NOT on `GroupConfig` — so it can only be
 * read here. Reading it off the group struct (which has no such field) is what
 * pinned every group to cycle 0.
 */
export async function getCycle(groupId: number | bigint): Promise<number> {
	return Number(await simulate<number>("get_cycle", [u64(groupId)]));
}

/** Member addresses, in rotation order. */
export async function getMembers(groupId: number | bigint): Promise<string[]> {
	return simulate<string[]>("get_members", [u64(groupId)]);
}

/**
 * Ledger timestamp (SECONDS) at which the current cycle's deposits opened.
 *
 * The contract's `CycleStart`. Adding `cycle_length` to it gives when the cycle
 * is due — which is what `groups.next_payout_at` is, and the basis the contract
 * itself measures lateness from in `resolve_default`.
 *
 * Worth knowing: a cycle can PAY OUT well before this window elapses (as soon
 * as everyone has paid), so this is the schedule, not a prediction of when the
 * money moves. See the deposit-window comment in the contract's `contribute`.
 */
export async function depositsOpenAt(
	groupId: number | bigint,
): Promise<number> {
	return Number(await simulate<bigint>("deposits_open_at", [u64(groupId)]));
}

/**
 * Whether `member` has paid for `cycle`.
 *
 * ARGUMENT ORDER IS LOAD-BEARING, and this is the one place it is easy to get
 * wrong: the contract reads `(group_id, cycle, member)` — cycle BEFORE member —
 * and Soroban resolves arguments positionally, so a swap is not a type error in
 * TypeScript but fails at simulation on every call. The parameters here are
 * ordered to match the contract exactly so the two can be compared by eye.
 *
 * The Laravel original passed NAMED arguments through the CLI, which made order
 * irrelevant; nothing about the positional ScVal form preserves that, so the
 * only guard is `scripts/check-contract-bindings.mjs`, which now compares
 * argument types positionally as well as counting them.
 */
export async function hasContributed(
	groupId: number | bigint,
	cycle: number,
	member: string,
): Promise<boolean> {
	return simulate<boolean>("has_contributed", [
		u64(groupId),
		u32(cycle),
		addr(member),
	]);
}

/**
 * Whether `member` has been removed (defaulted) from a group on-chain.
 *
 * A removed member no longer owes a contribution, so their absence must not
 * block the "everyone paid" auto-payout check, and the DB membership should
 * reflect the removal so the circle can see what happened.
 */
export async function isRemoved(
	groupId: number | bigint,
	member: string,
): Promise<boolean> {
	return simulate<boolean>("is_removed", [u64(groupId), addr(member)]);
}

/**
 * The address that will receive the current cycle's payout, or null once
 * every active member has already received their turn.
 *
 * Mirrors `trigger_payout`'s own recipient selection (contract doc comment at
 * `next_recipient`), so reading this before calling `triggerPayout` tells the
 * indexer exactly who is about to be paid without re-deriving that logic.
 */
export async function nextRecipient(
	groupId: number | bigint,
): Promise<string | null> {
	try {
		return await simulate<string>("next_recipient", [u64(groupId)]);
	} catch (error) {
		// GroupNotFound (#1) is how the contract signals "nobody left to pay" —
		// see `remaining_recipients` in trigger_payout.
		if (String(error).includes("Error(Contract, #1)")) return null;
		throw error;
	}
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
 * How much `member` has saved in a challenge, in stroops — read from the
 * SEPARATE challenge contract, not the savings contract.
 *
 * This is the challenge contract's own source of truth (its `balance_of` doc
 * comment: "the app's source of truth for progress... the figure is the
 * money itself, not a record of it"), so this is what the DB's
 * `ChallengeDeposit.status` should be reconciled against, the same way
 * `hasContributed` is what rotating-circle contributions reconcile against.
 */
export async function getChallengeBalance(
	challengeId: number | bigint,
	member: string,
): Promise<bigint> {
	assertChallengeConfigured();

	return BigInt(
		await simulate<bigint>(
			"balance_of",
			[u64(challengeId), addr(member)],
			CHALLENGE_CONTRACT_ID,
		),
	);
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
		Object.entries(configured).filter((entry): entry is [string, string] =>
			Boolean(entry[1]),
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

/** What the contract's `payout` event reports for one settled cycle. */
export interface PayoutEvent {
	cycle: number;
	recipient: string;
	/** The whole pool that was settled, in stroops. */
	gross: bigint;
	/** Service fee + late fee, forwarded to the organizer, in stroops. */
	fee: bigint;
	/** Recorded as the recipient's claimable balance, in stroops. */
	net: bigint;
}

/**
 * Read the `payout` event a `trigger_payout` transaction emitted.
 *
 * WHY THIS EXISTS. The indexer used to derive the recorded figures by reading
 * `get_pool` and `claimable_of` BEFORE calling `trigger_payout` and diffing
 * against a read taken after. Nothing serialises reconcile passes — `after()`,
 * two inline `runIndexer` call sites and the cron sweep can all touch one group
 * at once — so a second pass could capture its "before" values, watch the first
 * pass's payout land, and then compute `gross`/`fee` against a pool a different
 * pass had already consumed. The DB unique on (group_id, cycle) prevents a
 * DUPLICATE row; it does nothing about one row with the wrong numbers, written
 * `status: "confirmed"` and never revisited.
 *
 * The event carries `(cycle, recipient, pool, fee, net)` and is emitted inside
 * the payout itself, so it describes exactly the settlement this hash performed
 * — no before-state, nothing to race against. Concurrent passes now converge
 * instead of interleaving.
 *
 * Returns null if the transaction has no payout event (not yet applied, failed,
 * or not a payout).
 */
export async function getPayoutEvent(hash: string): Promise<PayoutEvent | null> {
	let tx;
	try {
		tx = await server.getTransaction(hash);
	} catch {
		return null;
	}

	if (tx.status !== "SUCCESS" || !tx.resultMetaXdr) return null;

	const soroban = tx.resultMetaXdr.v3?.()?.sorobanMeta?.();
	if (!soroban) return null;

	for (const event of soroban.events()) {
		const body = event.body().v0();
		const topics = body.topics();
		if (topics.length < 1) continue;

		// Topic 0 is the event name symbol; the contract publishes "payout".
		let name: unknown;
		try {
			name = scValToNative(topics[0]);
		} catch {
			continue;
		}
		if (name !== "payout") continue;

		let data: unknown;
		try {
			data = scValToNative(body.data());
		} catch {
			continue;
		}

		// Published as the tuple (cycle, recipient, pool, fee, net).
		if (!Array.isArray(data) || data.length < 5) continue;

		return {
			cycle: Number(data[0]),
			recipient: String(data[1]),
			gross: BigInt(data[2]),
			fee: BigInt(data[3]),
			net: BigInt(data[4]),
		};
	}

	return null;
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
export async function triggerPayout(groupId: number | bigint): Promise<string> {
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

/** Explorer link for a tx hash, matching the network in use. */
export function explorerUrl(hash: string): string {
	const network = IS_MAINNET ? "public" : "testnet";
	return `https://stellar.expert/explorer/${network}/tx/${hash}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The contract's Group struct, as decoded by `scValToNative`. */
/**
 * The contract's `GroupConfig` struct, exactly as `scValToNative` decodes it.
 *
 * THESE FIELD NAMES ARE THE CONTRACT'S, NOT THE DATABASE'S. An earlier version
 * of this interface described the DB serializer's shape instead
 * (`contribution_amount`, `cycle_length_days`, `current_cycle`, `members`,
 * `next_recipient`, `next_payout_at`). None of those exist on `GroupConfig`, so
 * every read of them was `undefined` — and because the consumers used
 * `?? 0`/`?? []` fallbacks, the reconciler silently treated every group as
 * "cycle 0, no members" forever instead of failing. Verified against the
 * deployed contract with `stellar contract info interface`.
 *
 * What genuinely is NOT here, and where to get it instead:
 *   - the current cycle     → `getCycle()`      (DataKey::Cycle)
 *   - the member roster     → `getMembers()`    (DataKey::Members)
 *   - the next recipient    → `nextRecipient()` (computed by scan, not index)
 *   - a next-payout time    → does not exist; the contract pays on "everyone
 *     has paid", never on elapsed time.
 */
export interface OnchainGroup {
	organizer: string;
	token: string;
	/** Per-cycle contribution, in stroops. */
	amount: bigint;
	/** Cycle length in SECONDS (not days). */
	cycle_length: bigint;
	fee_bps: number;
	late_fee_bps: number;
	/** Grace period in SECONDS (not hours). */
	grace_period: bigint;
	/** `PayoutOrder` ordinal: 0 Manual, 1 Random, 2 Vote, 3 Custom. */
	payout_order: number;
	/** `LatePenalty` ordinal: 0 DeductFromBalance, 1 RemoveMember. */
	late_penalty: number;
	member_count: number;
	/** `Status` ordinal: 0 Draft, 1 Open, 2 Active, 3 Completed. */
	status: number;
}
