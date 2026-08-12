"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { IoNotifications } from "react-icons/io5";
import { useNotifications } from "../../lib/hooks/useNotifications";
import { pageRoutes } from "../../config/routes";

function timeAgo(iso: string): string {
	const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
	if (Number.isNaN(seconds)) return "";
	if (seconds < 60) return "just now";
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.floor(hours / 24)}d ago`;
}

/**
 * The bell — unread count plus a dropdown of recent notifications.
 *
 * The badge is a REAL count from the database, not a decorative dot. It was
 * previously a bare link to the activity page precisely because there was no
 * count endpoint to back one; there is now.
 */
export default function NotificationBell() {
	const { rows, unread, live, markRead } = useNotifications();
	const [open, setOpen] = useState(false);
	const wrapper = useRef<HTMLDivElement>(null);

	// Close on outside click and on Escape — a dropdown that traps the user is
	// worse than no dropdown.
	useEffect(() => {
		if (!open) return;

		const onPointerDown = (event: MouseEvent) => {
			if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};

		document.addEventListener("mousedown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("mousedown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open]);

	return (
		<div ref={wrapper} className="relative">
			<button
				type="button"
				onClick={() => setOpen((value) => !value)}
				aria-label={
					unread > 0 ? `Notifications, ${unread} unread` : "Notifications"
				}
				aria-expanded={open}
				title={live ? "Notifications (live)" : "Notifications"}
				className="relative block"
			>
				<IoNotifications className="text-2xl md:text-3xl" />
				{unread > 0 && (
					<span
						className="absolute -right-1 -top-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-error-500 px-1 text-[10px] font-medium text-white"
						// The count is already in the button's aria-label, so the
						// badge itself is decorative to a screen reader.
						aria-hidden="true"
					>
						{unread > 9 ? "9+" : unread}
					</span>
				)}
			</button>

			{open && (
				<div className="absolute right-0 z-1100 mt-2 w-80 overflow-hidden rounded-2xl border border-[#eee] bg-white shadow-lg">
					<div className="flex items-center justify-between border-b border-[#f0f0f0] px-4 py-3">
						<span className="text-sm font-medium">Notifications</span>
						{unread > 0 && (
							<button
								type="button"
								onClick={() => void markRead()}
								className="text-xs font-medium text-primary"
							>
								Mark all read
							</button>
						)}
					</div>

					<div className="max-h-96 overflow-y-auto">
						{rows.length === 0 ? (
							<p className="px-4 py-8 text-center text-sm text-muted-foreground">
								Nothing yet. We&apos;ll tell you the moment something happens.
							</p>
						) : (
							rows.map((row) => {
								const content = (
									<>
										<span className="flex items-start gap-2">
											{!row.read_at && (
												<span
													className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary"
													aria-hidden="true"
												/>
											)}
											<span className={row.read_at ? "pl-4" : ""}>
												<span className="block text-sm font-medium">
													{row.title}
												</span>
												<span className="mt-0.5 block text-xs text-muted-foreground">
													{row.body}
												</span>
												<span className="mt-1 block text-[11px] text-muted-foreground">
													{timeAgo(row.created_at)}
												</span>
											</span>
										</span>
									</>
								);

								const onActivate = () => {
									if (!row.read_at) void markRead([row.id]);
									setOpen(false);
								};

								return row.href ? (
									<Link
										key={row.id}
										href={row.href}
										onClick={onActivate}
										className="block border-b border-[#f6f6f6] px-4 py-3 text-left transition-colors last:border-0 hover:bg-[#faf9ff]"
									>
										{content}
									</Link>
								) : (
									<button
										key={row.id}
										type="button"
										onClick={onActivate}
										className="block w-full border-b border-[#f6f6f6] px-4 py-3 text-left transition-colors last:border-0 hover:bg-[#faf9ff]"
									>
										{content}
									</button>
								);
							})
						)}
					</div>

					<Link
						href={pageRoutes.dashboardRoutes.ACTIVITY}
						onClick={() => setOpen(false)}
						className="block border-t border-[#f0f0f0] px-4 py-3 text-center text-sm font-medium text-primary"
					>
						See all activity
					</Link>
				</div>
			)}
		</div>
	);
}
