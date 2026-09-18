"use client";

import Link from "next/link";
import React, { useMemo } from "react";
import { pageRoutes } from "../../config/routes";
import { IoIosArrowRoundForward } from "react-icons/io";
import MyCircleCard from "../group/MyCircleCard";
import { useApi } from "../../lib/hooks/useApi";
import { groups as groupsApi } from "../../lib/api";
import { groupToCircle } from "../group/group-view";

export default function MyCircles() {
	const { data, loading } = useApi(() => groupsApi.index(), []);

	const circles = useMemo(
		() => (data ?? []).map(groupToCircle).slice(0, 4),
		[data],
	);

	return (
		<section>
			<div className="mt-7.5 md:mt-10 flex items-center justify-between">
				<h4 className="md:text-lg">Your Circles</h4>
				<Link
					href={pageRoutes.dashboardRoutes.GROUPS}
					className="flex items-center"
				>
					<span className="text-xs md:text-sm">View All</span>
					<IoIosArrowRoundForward className="text-lg md:text-2xl" />
				</Link>
			</div>

			{loading ? (
				<p className="mt-3.75 text-sm text-muted-foreground">
					Loading your circles…
				</p>
			) : circles.length === 0 ? (
				<p className="mt-3.75 text-sm text-muted-foreground">
					You haven&apos;t joined any circles yet.
				</p>
			) : (
				<div className="max-md:space-y-2 mt-3.75 lg:mt-6 md:grid md:grid-cols-2 md:gap-3.75">
					{circles.map((circle) => (
						<MyCircleCard key={circle.id} circle={circle} />
					))}
				</div>
			)}
		</section>
	);
}
