"use client";

import Link from "next/link";
import {
	HiOutlinePlusCircle,
	HiOutlineMagnifyingGlass,
	HiOutlineClock,
	HiOutlineQuestionMarkCircle,
} from "react-icons/hi2";
import { pageRoutes } from "../../config/routes";

const TILES = [
	{
		label: "Start New Group",
		Icon: HiOutlinePlusCircle,
		href: pageRoutes.dashboardRoutes.NEW_GROUP,
	},
	{
		label: "Browse Pool",
		Icon: HiOutlineMagnifyingGlass,
		href: pageRoutes.dashboardRoutes.GROUPS,
	},
	{
		label: "Savings History",
		Icon: HiOutlineClock,
		href: pageRoutes.dashboardRoutes.ACTIVITY,
	},
	{
		label: "How it works",
		Icon: HiOutlineQuestionMarkCircle,
		href: pageRoutes.landingPage,
	},
];

/** "Explore Communities" — quick action tiles at the bottom of the dashboard. */
export default function ExploreCommunities() {
	return (
		<section className="mt-8">
			<h4 className="md:text-lg">Explore Communities</h4>
			<div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
				{TILES.map(({ label, Icon, href }) => (
					<Link
						key={label}
						href={href}
						className="flex flex-col items-center gap-2 rounded-2xl bg-[#f8f8f8] px-3 py-5 text-center transition-colors hover:bg-[#f0f0f0]"
					>
						<span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f0ecff] text-primary">
							<Icon className="text-xl" />
						</span>
						<span className="text-xs font-medium">{label}</span>
					</Link>
				))}
			</div>
		</section>
	);
}
