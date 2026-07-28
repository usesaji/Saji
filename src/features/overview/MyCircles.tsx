import Link from "next/link";
import React from "react";
import { pageRoutes } from "../../config/routes";
import { IoIosArrowRoundForward } from "react-icons/io";
import MyCircleCard from "../group/MyCircleCard";
import { circleGroups } from "../../lib/utils/mock-data";

export default function MyCircles() {
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

			<div className="max-md:space-y-2 mt-3.75 lg:mt-6 md:grid md:grid-cols-2 md:gap-3.75">
				{circleGroups
					.filter((_, i) => i < 4)
					.map((circle) => (
						<MyCircleCard key={circle.id} circle={circle} />
					))}
			</div>
		</section>
	);
}
