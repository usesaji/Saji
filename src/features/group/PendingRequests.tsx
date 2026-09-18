"use client";

/* eslint-disable @next/next/no-img-element */
import { useCallback, useState } from "react";
import Link from "next/link";
import { IoIosArrowRoundForward } from "react-icons/io";
import { Button } from "../../components/ui/button";
import { useApi } from "../../lib/hooks/useApi";
import { groups as groupsApi, ApiError } from "../../lib/api";
import { pageRoutes } from "../../config/routes";
import { toast } from "../../lib/utils/toast";

const AVATAR = "/images/user.jpg";

/**
 * Pending join-request list for the organizer — approve or decline each request.
 * Used inline on the circle view (compact, capped) and on the full Requests page.
 * Only the organizer sees actions; non-organizers see nothing.
 */
export default function PendingRequests({
	groupId,
	isOrganizer,
	limit,
	showViewAll = false,
}: {
	groupId: number;
	isOrganizer: boolean;
	/** Cap the number shown (e.g. 2 on the circle view). */
	limit?: number;
	showViewAll?: boolean;
}) {
	const fetcher = useCallback(() => groupsApi.show(groupId), [groupId]);
	const { data, refetch } = useApi(fetcher, [groupId]);
	const [busy, setBusy] = useState<number | null>(null);

	const pending = (data?.members ?? []).filter((m) => m.status === "pending");
	const shown = limit ? pending.slice(0, limit) : pending;

	// Only the organizer can act, and only if there's anything pending.
	if (!isOrganizer || pending.length === 0) return null;

	const act = async (
		memberId: number,
		fn: () => Promise<unknown>,
		okMsg: string,
	) => {
		setBusy(memberId);
		try {
			await fn();
			toast.success(okMsg, "Done");
			refetch();
		} catch (err) {
			toast.error(
				err instanceof ApiError ? err.message : "Something went wrong.",
				"Failed",
			);
		} finally {
			setBusy(null);
		}
	};

	return (
		<section className="mt-8">
			<div className="flex items-center justify-between">
				<h4 className="flex items-center gap-2 md:text-lg">
					Pending Requests
					<span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-error-500 px-1 text-[10px] text-white">
						{pending.length}
					</span>
				</h4>
				{showViewAll && pending.length > (limit ?? 0) && (
					<Link
						href={pageRoutes.dashboardRoutes.GROUP_REQUESTS(groupId)}
						className="flex items-center text-xs md:text-sm"
					>
						View All <IoIosArrowRoundForward className="text-lg md:text-2xl" />
					</Link>
				)}
			</div>

			<div className="mt-4 space-y-2">
				{shown.map((m) => (
					<div
						key={m.id}
						className="flex items-center justify-between gap-3 rounded-xl bg-[#f8f8f8] px-3 py-2.5"
					>
						<div className="flex min-w-0 items-center gap-2">
							<div className="h-9 w-9 shrink-0 overflow-hidden rounded-full">
								<img
									src={AVATAR}
									alt={m.user?.name ?? "member"}
									className="h-full w-full object-cover"
								/>
							</div>
							<div className="min-w-0">
								<p className="truncate text-sm font-medium">
									{m.user?.name ?? "Member"}
								</p>
								<p className="text-xs text-muted-foreground">Requested to join</p>
							</div>
						</div>
						<div className="flex shrink-0 gap-2">
							<Button
								size="sm"
								variant="outline"
								isLoading={busy === m.id}
								onClick={() =>
									act(
										m.id,
										() => groupsApi.decline(groupId, m.id),
										"Request declined.",
									)
								}
							>
								Decline
							</Button>
							<Button
								size="sm"
								isLoading={busy === m.id}
								onClick={() =>
									act(
										m.id,
										() => groupsApi.approve(groupId, m.id),
										"Member approved.",
									)
								}
							>
								Approve
							</Button>
						</div>
					</div>
				))}
			</div>
		</section>
	);
}
