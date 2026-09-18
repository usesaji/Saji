/**
 * Exact money math for Stellar amounts.
 *
 * Stellar is 7-decimal fixed point ("stroops"), and every amount that matters —
 * balances, payouts, what a user typed — must be compared and summed exactly.
 * JavaScript numbers cannot do that: `Number("0.1") * 1e7` is 1000000.0000000001,
 * `Number()` on an i128 above 2^53 silently truncates, and summing floats makes
 * "is this the whole balance?" comparisons need epsilons that are themselves
 * bigger than a stroop.
 *
 * Everything here is `bigint` stroops. Convert to a display string only at the
 * edge, never back into arithmetic.
 */

export const STROOPS_PER_UNIT = 10_000_000n;
const DECIMALS = 7;

/**
 * Parse a decimal amount string into stroops, digit-wise — never via float.
 *
 * Accepts "1", "1.5", ".5", "0.0000001". Extra decimals beyond 7 are truncated
 * (not rounded up), so we can never build a transaction for more than the user
 * typed. Returns null for anything unparseable.
 */
export function toStroops(amount: string | number | bigint): bigint | null {
	if (typeof amount === "bigint") return amount;

	const raw = String(amount).trim();
	if (raw === "" || !/^-?\d*\.?\d*$/.test(raw) || raw === "." || raw === "-") {
		return null;
	}

	const negative = raw.startsWith("-");
	const body = negative ? raw.slice(1) : raw;
	const [whole = "", frac = ""] = body.split(".");
	const padded = (frac + "0".repeat(DECIMALS)).slice(0, DECIMALS);

	const value =
		BigInt(whole === "" ? "0" : whole) * STROOPS_PER_UNIT +
		BigInt(padded === "" ? "0" : padded);

	return negative ? -value : value;
}

/** Parse, treating anything unparseable as zero. For user input fields. */
export function toStroopsOrZero(amount: string | number | bigint): bigint {
	return toStroops(amount) ?? 0n;
}

/**
 * Render stroops as a plain decimal string (no thousands separators), trimming
 * trailing zeros. "10000000" → "1", "1" → "0.0000001".
 */
export function fromStroops(stroops: bigint): string {
	const negative = stroops < 0n;
	const abs = negative ? -stroops : stroops;
	const whole = abs / STROOPS_PER_UNIT;
	const frac = (abs % STROOPS_PER_UNIT).toString().padStart(DECIMALS, "0");
	const trimmed = frac.replace(/0+$/, "");
	const text = trimmed === "" ? `${whole}` : `${whole}.${trimmed}`;
	return negative ? `-${text}` : text;
}

/** Render stroops for display, with thousands separators. */
export function formatStroops(stroops: bigint): string {
	const text = fromStroops(stroops);
	const [whole, frac] = text.split(".");
	const grouped = BigInt(whole).toLocaleString("en-US");
	return frac ? `${grouped}.${frac}` : grouped;
}
