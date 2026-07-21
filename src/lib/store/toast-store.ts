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

export const useToastStore = create<ToastState>((set) => ({
	open: false,
	title: undefined,
	message: "",
	variant: "success",

	show: (message, variant = "success", title) => {
		set({
			open: true,
			message,
			variant,
			title,
		});

		setTimeout(() => {
			set({ open: false });
		}, 4000);
	},

	close: () => set({ open: false }),
}));
