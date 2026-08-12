// lib/stores/toast-store.ts

import { create } from "zustand";

export type ToastVariant = "success" | "error" | "info" | "warning";

interface ToastState {
	open: boolean;
	title?: string;
	message: string;
	variant: ToastVariant;

	show: (message: string, variant?: ToastVariant, title?: string) => void;

	close: () => void;
}

const AUTO_DISMISS_MS = 4000;

/**
 * The pending auto-dismiss, tracked so a new toast can cancel the previous
 * one's timer.
 *
 * Without this, each `show` scheduled an INDEPENDENT 4s timeout that closed
 * whatever happened to be on screen when it fired. Show toast A at t=0 and
 * toast B at t=3s and A's orphaned timer closed B one second after it appeared
 * — which is exactly the multi-toast pattern the withdraw flow (partial claim
 * failure) and group creation (create + invite) both produce.
 */
let dismissTimer: ReturnType<typeof setTimeout> | null = null;

export const useToastStore = create<ToastState>((set) => ({
	open: false,
	title: undefined,
	message: "",
	variant: "success",

	show: (message, variant = "success", title) => {
		if (dismissTimer !== null) clearTimeout(dismissTimer);

		set({
			open: true,
			message,
			variant,
			title,
		});

		dismissTimer = setTimeout(() => {
			dismissTimer = null;
			set({ open: false });
		}, AUTO_DISMISS_MS);
	},

	close: () => {
		if (dismissTimer !== null) {
			clearTimeout(dismissTimer);
			dismissTimer = null;
		}
		set({ open: false });
	},
}));
