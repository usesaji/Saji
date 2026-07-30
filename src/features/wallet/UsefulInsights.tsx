import React from "react";
import { FiPlus, FiUsers } from "react-icons/fi";
import { PiWalletLight } from "react-icons/pi";

const insights = [
	{
		icon: FiPlus,
		iconBg: "bg-success-50",
		iconColor: "text-success-600",
		title: "Savings Growth",
		subtitle: "+12% vs Last Month",
	},
	{
		icon: FiUsers,
		iconBg: "bg-primary-light",
		iconColor: "text-primary",
		title: "Active Groups",
		subtitle: "3 Active Group Cycles",
	},
	{
		icon: PiWalletLight,
		iconBg: "bg-accent-light",
		iconColor: "text-accent",
		title: "Next Payout",
		subtitle: "₦120k in 15 days.",
	},
];

export default function UsefulInsights() {
	return (
		<section>
			<h4 className="mt-7.5 md:mt-10 md:text-lg">Useful Insights</h4>

			<div className="max-md:space-y-2 mt-3.75 lg:mt-6 md:grid md:grid-cols-3 md:gap-3.75">
				{insights.map((item) => (
					<div
						key={item.title}
						className="flex items-center gap-3 rounded-[15px] border border-dashed border-neutral-light-hover p-4 md:p-4.5"
					>
						<div
							className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${item.iconBg} ${item.iconColor}`}
						>
							<item.icon className="text-lg" />
						</div>
						<div className="min-w-0">
							<p className="text-sm font-medium text-neutral-dark truncate">
								{item.title}
							</p>
							<p className="text-xs font-light text-neutral-light-active truncate">
								{item.subtitle}
							</p>
						</div>
					</div>
				))}
			</div>
		</section>
	);
}
