"use client";

import { useCallback, useState } from "react";
import { HiOutlineClipboardDocument, HiCheck } from "react-icons/hi2";
import { useApi } from "../../lib/hooks/useApi";
import { groups as groupsApi } from "../../lib/api";

/**
 * Organizer's shareable invite link for a group. Fetches the group's invite
 * token/URL and offers a one-tap copy. Prospective members open the link to the
 * join page and request to join.
 */
export default function InviteLink({ groupId }: { groupId: number }) {
	const fetcher = useCallback(() => groupsApi.inviteLink(groupId), [groupId]);
	const { data, loading, error, refetch } = useApi(fetcher, [groupId]);
	const [copied, setCopied] = useState(false);

	// Prefer the backend-built absolute URL; fall back to the current origin.
	const link =
		data?.invite_url ??
		(data?.invite_token && typeof window !== "undefined"
			? `${window.location.origin}/groups/join/${data.invite_token}`
			: null);

	const copy = async () => {
		if (!link) return;
		try {
			await navigator.clipboard.writeText(link);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			/* clipboard blocked — user can still select the text */
		}
	};

	return (
		<section className="mt-8 rounded-2xl bg-[#f7f7f7] p-4 md:p-6">
			<h3 className="md:text-xl">Invite members</h3>
			<p className="mt-1 text-xs font-light text-muted-foreground">
				Share this link. Anyone who opens it can request to join the circle.
			</p>

			{loading && (
				<p className="mt-3 text-sm text-muted-foreground">Loading link…</p>
			)}

			{error && !loading && (
				<div className="mt-3 text-sm">
					<p className="text-error-500">{error}</p>
					<button onClick={refetch} className="mt-1 font-medium underline">
						Try again
					</button>
				</div>
			)}

			{link && !loading && (
				<div className="mt-3 flex items-center gap-2">
					<input
						readOnly
						value={link}
						onFocus={(e) => e.currentTarget.select()}
						className="min-w-0 flex-1 truncate rounded-full border border-neutral-light-hover bg-white px-4 py-2.5 text-sm"
					/>
					<button
						type="button"
						onClick={copy}
						className="flex shrink-0 items-center gap-1 rounded-full bg-primary px-4 py-2.5 text-sm text-white transition hover:bg-primary-hover"
					>
						{copied ? (
							<>
								<HiCheck className="text-base" /> Copied
							</>
						) : (
							<>
								<HiOutlineClipboardDocument className="text-base" /> Copy
							</>
						)}
					</button>
				</div>
			)}
		</section>
	);
}
