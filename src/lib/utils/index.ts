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
