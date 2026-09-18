// lib/toast.ts

import { useToastStore } from "../store/toast-store";

export const toast = {
	success: (message: string, title?: string) =>
		useToastStore.getState().show(message, "success", title),

	error: (message: string, title?: string) =>
		useToastStore.getState().show(message, "error", title),

	info: (message: string, title?: string) =>
		useToastStore.getState().show(message, "info", title),

	warning: (message: string, title?: string) =>
		useToastStore.getState().show(message, "warning", title),
};
