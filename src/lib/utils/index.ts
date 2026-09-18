import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

/**
 * Assets a balance can be shown in. Values are the asset CODES exactly as they
 * come back from Horizon (uppercase) — balance maps are keyed by those, so a
 * lowercase value here silently looks up `undefined` and renders 0.
 *
 * Crypto only: Saji settles on Stellar, so a fiat entry would always read zero
 * while claiming to be a balance.
 */
export const currencies = [
	{ label: "USDC", value: "USDC" },
	{ label: "USDT", value: "USDT" },
	{ label: "XLM", value: "XLM" },
];

/**
 * Format a backend decimal-string amount (e.g. "2450000.8000000") for display.
 *
 * `assetCode` is required for anything the user reads as money: without it an
 * XLM balance renders as "$1,234.00", which is not a dollar amount, and small
 * balances (0.0012345 XLM) round to "$0.00" and look like nothing. Pass the
 * code and the amount is suffixed instead, keeping up to 7 dp.
 *
 * Returns "—" for null/undefined so unlinked/empty states read clean.
 */
export function formatMoney(
	amount: string | number | null | undefined,
	assetCode?: string,
): string {
	if (amount === null || amount === undefined || amount === "") return "—";
	const n = typeof amount === "number" ? amount : Number(amount);
	if (Number.isNaN(n)) return "—";

	if (!assetCode) {
		// No asset named — show a plain number rather than asserting a currency.
		return n.toLocaleString(undefined, {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		});
	}

	// Keep enough precision that a real balance never displays as zero.
	const text = n.toLocaleString(undefined, {
		minimumFractionDigits: 2,
		maximumFractionDigits: n !== 0 && Math.abs(n) < 0.01 ? 7 : 2,
	});
	return `${text} ${assetCode}`;
}
