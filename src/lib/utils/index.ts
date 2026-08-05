import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export const currencies = [
	{ label: "USDC", value: "usdc" },
	{ label: "Naira", value: "naira" },
	{ label: "XLM", value: "xlm" },
];

/**
 * Format a backend decimal-string amount (e.g. "2450000.8000000") for display.
 * Backend amounts are 7-dp strings; show them with thousands separators and 2
 * decimals. Returns "—" for null/undefined so unlinked/empty states read clean.
 */
export function formatMoney(
	amount: string | number | null | undefined,
	prefix = "$",
): string {
	if (amount === null || amount === undefined || amount === "") return "—";
	const n = typeof amount === "number" ? amount : Number(amount);
	if (Number.isNaN(n)) return "—";
	return `${prefix}${n.toLocaleString(undefined, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`;
}
