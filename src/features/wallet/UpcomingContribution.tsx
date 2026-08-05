"use client";

import Link from "next/link";
import { HiOutlineBanknotes } from "react-icons/hi2";
import { pageRoutes } from "../../config/routes";
import type { QuickDeposit } from "../../lib/api";

/**
 * "Upcoming Contribution" banner — surfaces the soonest-due contribution and a
 * Fund Account action. Renders nothing when there's nothing due.
 */
export default function UpcomingContribution({
	due,
}: {
	due: QuickDeposit | null;
}) {
	if (!due) return null;

	const amount = `${Number(due.amount).toLocaleString()} ${due.asset_code}`;
	const when = due.due_at ? whenLabel(due.due_at) : "soon";

	return (
		<section className="mt-8 flex flex-col gap-4 rounded-2xl bg-[#f7f7f7] p-4 md:flex-row md:items-center md:justify-between md:p-6">
			<div className="min-w-0">
				<p className="text-sm font-medium md:text-base">Upcoming Contribution</p>
				<p className="mt-1 text-xs font-light text-muted-foreground md:text-sm">
					Your contribution of <span className="font-medium">{amount}</span> to
					“{due.group_name}” is due {when}. Keep enough tokens in your wallet to
					avoid a late penalty.
				</p>
			</div>
			<Link
				href={pageRoutes.dashboardRoutes.GROUP(String(due.group_id))}
				className="flex shrink-0 items-center justify-center gap-2 rounded-full bg-black px-5 py-3 text-sm font-medium text-white"
			>
				<HiOutlineBanknotes className="text-lg" />
				Fund Account
			</Link>
		</section>
	);
}

function whenLabel(iso: string): string {
	const d = Math.round(
		(new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
	);
	if (d === 0) return "today";
	if (d > 0) return `in ${d} day${d === 1 ? "" : "s"}`;
	return `${Math.abs(d)} day${d === -1 ? "" : "s"} ago`;
}
