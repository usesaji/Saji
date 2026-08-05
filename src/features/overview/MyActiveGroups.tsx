"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { IoIosArrowRoundForward } from "react-icons/io";
import { Button } from "../../components/ui/button";
import { pageRoutes } from "../../config/routes";
import type { DashboardCircle } from "../../lib/api";

const AVATARS = "/images/review-user-imgs.png";

/**
 * "My Active Groups" — the user's current circles as horizontal cards, matching
 * the dashboard design (target progress, member count, View Details). Uses the
 * circles already loaded on the dashboard payload.
 */
export default function MyActiveGroups({
	circles,
}: {
	circles: DashboardCircle[];
}) {
	return (
		<section className="mt-8">
			<div className="flex items-center justify-between">
				<h4 className="md:text-lg">My Active Groups ({circles.length})</h4>
				<Link
					href={pageRoutes.dashboardRoutes.GROUPS}
					className="flex items-center text-xs md:text-sm"
				>
					View All <IoIosArrowRoundForward className="text-lg md:text-2xl" />
				</Link>
			</div>

			{circles.length === 0 ? (
				<p className="mt-4 text-sm text-muted-foreground">
					You&apos;re not in any active groups yet.
				</p>
			) : (
				<div className="mt-4 flex gap-4 overflow-x-auto hide-scroll pb-2">
					{circles.map((c) => (
						<div
							key={c.id}
							className="w-64 shrink-0 rounded-2xl bg-[#f8f8f8] p-4"
						>
							<div className="flex items-center justify-between">
								<span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium capitalize text-primary">
									{c.status}
								</span>
								<span className="text-xs text-muted-foreground">
									{c.contributed_this_cycle ? "Paid" : "Due"}
								</span>
							</div>

							<p className="mt-3 truncate text-sm font-medium">{c.name}</p>
							<p className="text-xs text-muted-foreground">
								{Number(c.contribution_amount).toLocaleString()} {c.asset_code} /
								cycle
							</p>

							<div className="mt-4 flex items-center justify-between gap-3">
								<div className="flex items-center gap-2">
									<div className="h-6">
										<img src={AVATARS} alt="members" className="h-full" />
									</div>
									<span className="text-xs">{c.member_count} Members</span>
								</div>
								<Button
									href={pageRoutes.dashboardRoutes.GROUP(String(c.id))}
									variant="dark"
									size="sm"
								>
									View Details
								</Button>
							</div>
						</div>
					))}
				</div>
			)}
		</section>
	);
}
