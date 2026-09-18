"use client";

import { useCallback, useEffect, useState } from "react";
import {
	notifications as notificationsApi,
	type NotificationRow,
} from "../api";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

export type Notifications = {
	rows: NotificationRow[];
	unread: number;
	loading: boolean;
	/** True once the Realtime socket is live — the bell can show it's current. */
	live: boolean;
	refresh: () => void;
	markRead: (ids?: number[]) => Promise<void>;
};

/**
 * The user's notifications, delivered instantly.
 *
 * TWO LAYERS, on purpose:
 *
 *   1. A fetch on mount and on window focus. Always runs, needs no
 *      configuration, and is the correctness floor — if everything else fails
 *      the user still sees their notifications on the next focus.
 *   2. A Supabase Realtime subscription. Postgres pushes the new row down a
 *      websocket the moment it is inserted, so an open tab updates without
 *      polling.
 *
 * Layer 2 is an ENHANCEMENT and is allowed to fail. If the Supabase env vars
 * are missing, or the token endpoint reports `enabled: false`, or the socket
 * drops, the hook keeps working on layer 1 alone. Nothing here should ever
 * surface a Realtime problem as a user-facing error — the notifications are
 * already durable in the database.
 */
export function useNotifications(): Notifications {
	const [rows, setRows] = useState<NotificationRow[]>([]);
	const [unread, setUnread] = useState(0);
	const [loading, setLoading] = useState(true);
	const [live, setLive] = useState(false);

	const refresh = useCallback(async () => {
		try {
			const page = await notificationsApi.index({ per_page: 20 });
			setRows(page.data);
			setUnread(page.unread_count);
		} catch {
			// Leave whatever is on screen. A failed refresh must not blank a list
			// the user can still act on.
		} finally {
			setLoading(false);
		}
	}, []);

	// Layer 1 — mount + focus.
	useEffect(() => {
		let cancelled = false;
		const run = () => {
			if (!cancelled) void refresh();
		};

		// Deferred rather than called in the effect body: fetching synchronously
		// here sets state during the commit and cascades a second render before
		// the first has painted.
		const timer = setTimeout(run, 0);
		window.addEventListener("focus", run);

		return () => {
			cancelled = true;
			clearTimeout(timer);
			window.removeEventListener("focus", run);
		};
	}, [refresh]);

	// Layer 2 — Realtime.
	useEffect(() => {
		if (!SUPABASE_URL || !SUPABASE_KEY) return;

		let cancelled = false;
		let cleanup: (() => void) | null = null;

		(async () => {
			try {
				const auth = await notificationsApi.realtimeToken();
				if (cancelled || !auth.enabled) return;

				// Imported lazily: the Supabase client is a real chunk, and only a
				// signed-in user with the bell mounted ever needs it.
				const { createClient } = await import("@supabase/supabase-js");
				if (cancelled) return;

				const client = createClient(SUPABASE_URL, SUPABASE_KEY, {
					auth: { persistSession: false, autoRefreshToken: false },
				});

				// The minted JWT, not a Supabase session — this is what the RLS
				// policy reads `saji_user_id` out of.
				client.realtime.setAuth(auth.token);

				const channel = client
					.channel(`notifications:${auth.user_id}`)
					.on(
						"postgres_changes",
						{
							event: "INSERT",
							schema: "public",
							table: "notifications",
							// Belt and braces: RLS already isolates rows, this just
							// avoids shipping other users' inserts to be discarded.
							filter: `user_id=eq.${auth.user_id}`,
						},
						(payload) => {
							const row = payload.new as NotificationRow;

							setRows((current) =>
								// Guard against a focus-refresh having already
								// inserted it — both layers can deliver the same row.
								current.some((existing) => String(existing.id) === String(row.id))
									? current
									: [row, ...current].slice(0, 20),
							);
							if (!row.read_at) setUnread((n) => n + 1);
						},
					)
					.subscribe((status) => {
						if (cancelled) return;
						setLive(status === "SUBSCRIBED");
					});

				cleanup = () => {
					setLive(false);
					void client.removeChannel(channel);
				};
			} catch {
				// Realtime is optional. Layer 1 already covers correctness.
			}
		})();

		return () => {
			cancelled = true;
			cleanup?.();
		};
	}, []);

	const markRead = useCallback(async (ids?: number[]) => {
		// Optimistic: the badge should clear the instant it is tapped. A failed
		// write is corrected by the next refresh, and the cost of being wrong is
		// a badge that reappears — not lost data.
		const now = new Date().toISOString();
		const target = ids ? new Set(ids.map(String)) : null;

		setRows((current) =>
			current.map((row) =>
				row.read_at || (target && !target.has(String(row.id)))
					? row
					: { ...row, read_at: now },
			),
		);
		// Counted from the rows currently in the closure rather than a ref. The
		// badge counts ALL unread, not just this page, so it is decremented by
		// what we actually flipped instead of recomputed from `rows`.
		const flipped = target
			? rows.filter((row) => !row.read_at && target.has(String(row.id))).length
			: 0;
		setUnread((n) => (target ? Math.max(0, n - flipped) : 0));

		try {
			const result = await notificationsApi.markRead(
				ids ? { ids } : { all: true },
			);
			setUnread(result.unread_count);
		} catch {
			void refresh();
		}
	}, [refresh, rows]);

	return { rows, unread, loading, live, refresh, markRead };
}
