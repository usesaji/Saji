"use client";

import Link from "next/link";
import { useCallback } from "react";
import { pageRoutes } from "../../config/routes";
import { IoIosArrowRoundForward } from "react-icons/io";
import ActivityCard from "../activity/ActivityCard";
import { useApi } from "../../lib/hooks/useApi";
import { activity as activityApi } from "../../lib/api";

export default function RecentActivities() {
	const fetcher = useCallback(() => activityApi.index({ per_page: 4 }), []);
	const { data, loading } = useApi(fetcher, []);

	const rows = data?.data ?? [];

	return (
		<section>
			<div className="mt-7.5 md:mt-10 flex items-center justify-between">
				<h4 className="md:text-lg">Recent Activities</h4>
				<Link
					href={pageRoutes.dashboardRoutes.ACTIVITY}
					className="flex items-center"
				>
					<span className="text-xs md:text-sm">View All</span>
					<IoIosArrowRoundForward className="text-lg md:text-2xl" />
				</Link>
			</div>

			{loading ? (
				<p className="mt-3.75 text-sm text-muted-foreground">
					Loading activity…
				</p>
			) : rows.length === 0 ? (
				<p className="mt-3.75 text-sm text-muted-foreground">
					No activity yet.
				</p>
			) : (
				<div className="max-md:space-y-2 mt-3.75 lg:mt-6 md:grid md:grid-cols-2 md:gap-3.75">
					{rows.map((row) => (
						<ActivityCard key={row.id} activity={row} />
					))}
				</div>
			)}
		</section>
	);
}
