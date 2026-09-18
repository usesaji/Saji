"use client";

/* eslint-disable @next/next/no-img-element */
import { useCallback } from "react";
import Link from "next/link";
import { IoIosArrowRoundForward } from "react-icons/io";
import { useApi } from "../../lib/hooks/useApi";
import { groups as groupsApi } from "../../lib/api";
import { pageRoutes } from "../../config/routes";

const AVATAR = "/images/user.jpg";

/**
 * Payout Rotation strip for a circle — members in payout order with a Current /
 * Next Cycle marker, matching the dashboard design. Pulls the real rotation from
 * the circle endpoint for the given group.
 */
export default function PayoutRotation({ groupId }: { groupId: number }) {
	const fetcher = useCallback(() => groupsApi.circle(groupId), [groupId]);
	const { data, loading } = useApi(fetcher, [groupId]);

	const rotation = data?.payout_rotation ?? [];
	const currentCycle = data?.current_cycle ?? 0;

	return (
		<section className="mt-8">
			<div className="flex items-center justify-between">
				<h4 className="md:text-lg">Payout Rotation</h4>
				<Link
					href={pageRoutes.dashboardRoutes.GROUP(String(groupId))}
					className="flex items-center text-xs md:text-sm"
				>
					View All <IoIosArrowRoundForward className="text-lg md:text-2xl" />
				</Link>
			</div>

			{loading ? (
				<p className="mt-4 text-sm text-muted-foreground">Loading rotation…</p>
			) : rotation.length === 0 ? (
				<p className="mt-4 text-sm text-muted-foreground">
					No rotation yet — start the cycle to set the payout order.
				</p>
			) : (
				<div className="mt-4 flex gap-5 overflow-x-auto hide-scroll pb-2">
					{rotation.map((m) => {
						const isCurrent = m.position - 1 === currentCycle;
						return (
							<div
								key={m.user_id}
								className="flex w-16 shrink-0 flex-col items-center text-center"
							>
								<div className="relative">
									<div className="h-14 w-14 overflow-hidden rounded-full bg-[#f0ecff]">
										<img
											src={AVATAR}
											alt={m.name ?? "member"}
											className="h-full w-full object-cover"
										/>
									</div>
									{m.has_received_payout && (
										<span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-success-700 text-[10px] text-white">
											✓
										</span>
									)}
								</div>
								<p className="mt-1 w-full truncate text-xs font-medium">
									{m.name ?? "Member"}
								</p>
								<p className="text-[10px] text-muted-foreground">
									{isCurrent ? "Current" : "Next Cycle"}
								</p>
							</div>
						);
					})}
				</div>
			)}
		</section>
	);
}
