"use client";

import { useCallback } from "react";
import { useParams } from "next/navigation";
import { HiOutlineAdjustmentsHorizontal } from "react-icons/hi2";
import GoBack from "@/components/dashboard/GoBack";
import { useApi } from "@/lib/hooks/useApi";
import { groups as groupsApi, auth } from "@/lib/api";
import PendingRequests from "@/features/group/PendingRequests";

/** Full "Member Requests" page — pending join requests with Approve / Decline. */
export default function GroupRequestsPage() {
	const { groupId } = useParams<{ groupId: string }>();
	const id = Number(groupId);

	const { data: group, loading } = useApi(
		useCallback(() => groupsApi.show(id), [id]),
		[id],
	);
	const { data: me } = useApi(useCallback(() => auth.me(), []), []);
	const isOrganizer = !!(me && group && me.id === group.organizer_id);

	const pendingCount = (group?.members ?? []).filter(
		(m) => m.status === "pending",
	).length;

	return (
		<div className="mx-auto max-w-3xl pb-10">
			<GoBack />

			<div className="mt-4 flex items-center justify-between">
				<h2 className="text-xl font-medium md:text-2xl">Requests</h2>
				<button
					type="button"
					className="flex items-center gap-1.5 rounded-full border border-neutral-light-hover px-3 py-1.5 text-sm"
				>
					<HiOutlineAdjustmentsHorizontal className="text-base" />
					Filter
				</button>
			</div>

			{loading ? (
				<p className="mt-6 text-sm text-muted-foreground">Loading requests…</p>
			) : !isOrganizer ? (
				<p className="mt-6 text-sm text-muted-foreground">
					Only the organizer can review join requests.
				</p>
			) : pendingCount === 0 ? (
				<p className="mt-6 text-sm text-muted-foreground">
					No pending requests.
				</p>
			) : (
				<PendingRequests groupId={id} isOrganizer={isOrganizer} />
			)}
		</div>
	);
}
