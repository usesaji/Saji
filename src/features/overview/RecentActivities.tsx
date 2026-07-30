'use client'
import Link from "next/link";
import { useRouter } from "next/navigation";
import { pageRoutes } from "../../config/routes";
import { IoIosArrowRoundForward } from "react-icons/io";
import ActivityCard, { Transaction } from "../activity/ActivityCard";
import { mockTransactions } from "../../lib/utils/mock-transactions";

export default function RecentActivities() {
	const router = useRouter();

	const handleViewDetails = (tx: Transaction) => {
		router.push(`${pageRoutes.dashboardRoutes.ACTIVITY}?tx=${tx.id}`);
	};

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

			<div className="max-md:space-y-2 mt-3.75 lg:mt-6 md:grid md:grid-cols-2 md:gap-3.75">
				{mockTransactions.filter((_, i)=> i < 5  ).map((tx) => (
					<ActivityCard key={tx.id} tx={tx} onViewDetails={handleViewDetails} />
				))}
			</div>
		</section>
	);
}
