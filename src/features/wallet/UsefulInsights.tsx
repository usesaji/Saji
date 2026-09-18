"use client";

import {
	HiOutlineArrowTrendingUp,
	HiOutlineUserGroup,
	HiOutlineBanknotes,
} from "react-icons/hi2";
import type { DashboardData } from "../../lib/api";

/**
 * "Useful Insights" — three at-a-glance stat tiles on the Wallet screen:
 * Savings Growth, Active Groups, and Next Payout. Driven by the dashboard data.
 */
export default function UsefulInsights({ data }: { data: DashboardData }) {
	const due = data.quick_deposit;

	// Next payout: derived from the soonest-due contribution, if any.
	const nextPayout = due
		? `${Number(due.amount).toLocaleString()} ${due.asset_code}${
				due.due_at ? ` · ${daysUntil(due.due_at)}` : ""
			}`
		: "—";

	const tiles = [
		{
			Icon: HiOutlineArrowTrendingUp,
			tone: "text-success-700",
			label: "Savings Growth",
			// No historical growth metric server-side yet — show current balance.
			// `saved_balance` is the LARGEST single asset, so a user saving in
			// several currencies gets a "+N more" hint rather than a figure that
			// silently omits the rest. This tile is too small for a breakdown;
			// the overview card owns that.
			value:
				`${Number(data.saved_balance).toLocaleString()} ${data.asset_code}` +
				((data.assets?.length ?? 0) > 1
					? ` +${data.assets.length - 1} more`
					: ""),
		},
		{
			Icon: HiOutlineUserGroup,
			tone: "text-primary",
			label: "Active Groups",
			value: `${data.circles_total} circle${data.circles_total === 1 ? "" : "s"}`,
		},
		{
			Icon: HiOutlineBanknotes,
			tone: "text-accent",
			label: "Next Payout",
			value: nextPayout,
		},
	];

	return (
		<section className="mt-8">
			<h4 className="md:text-lg">Useful Insights</h4>
			<div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
				{tiles.map(({ Icon, tone, label, value }) => (
					<div key={label} className="rounded-2xl bg-[#f8f8f8] p-4">
						<span
							className={`flex h-9 w-9 items-center justify-center rounded-full bg-white ${tone}`}
						>
							<Icon className="text-lg" />
						</span>
						<p className="mt-3 text-xs text-muted-foreground">{label}</p>
						<p className="mt-0.5 text-sm font-semibold md:text-base">{value}</p>
					</div>
				))}
			</div>
		</section>
	);
}

/** "in 6 days" / "today" from an ISO date. */
function daysUntil(iso: string): string {
	const d = Math.round(
		(new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
	);
	if (d === 0) return "today";
	if (d > 0) return `in ${d} day${d === 1 ? "" : "s"}`;
	return `${Math.abs(d)} day${d === -1 ? "" : "s"} ago`;
}
