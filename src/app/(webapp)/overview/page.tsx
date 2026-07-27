import React from "react";
import { WalletCard } from "../../../features/wallet/WalletBallanceCard";
import { IoIosArrowRoundForward } from "react-icons/io";
import Link from "next/link";
import { pageRoutes } from "../../../config/routes";
import MyCircleCard from "../../../features/group/MyCircleCard";

export default function Page() {
	return (
		<div>
			<WalletCard />

			<section>
				<div className="mt-7.5 md:mt-10 flex items-center justify-between">
					<h4 className="md:text-lg">Your Circles</h4>
					<Link
						href={pageRoutes.dashboardRoutes.GROUP}
						className="flex items-center"
					>
						<span className="text-xs md:text-sm">View All</span>
						<IoIosArrowRoundForward className="text-lg md:text-2xl" />
					</Link>
				</div>

				<div className="max-md:space-y-2 mt-3.75 lg:mt-6 md:grid md:grid-cols-2 md:gap-3.75">
					<MyCircleCard />
					<MyCircleCard />
					<MyCircleCard />
					<MyCircleCard />
				</div>
			</section>
		</div>
	);
}
