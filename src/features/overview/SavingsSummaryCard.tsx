"use client";

/* eslint-disable @next/next/no-img-element */
import { useState } from "react";
import Link from "next/link";
import { IoEye, IoEyeOff } from "react-icons/io5";
import { HiOutlinePlusSmall } from "react-icons/hi2";
import { Button } from "../../components/ui/button";
import { formatMoney } from "../../lib/utils";
import { pageRoutes } from "../../config/routes";
import type { DashboardData } from "../../lib/api";

const AVATARS = "/images/review-user-imgs.png";

/**
 * Total Group Savings hero card + the "amount due" banner — the top of the
 * dashboard. Mirrors the desktop design: headline balance, a circle-progress
 * bar, member avatars, a privacy (eye) toggle, and Pay Now / Invite actions.
 */
export default function SavingsSummaryCard({ data }: { data: DashboardData }) {
	const [hidden, setHidden] = useState(false);

	const saved = Number(data.saved_balance ?? 0);
	// Circle progress: a rough sense of activity — cycles paid this period across
	// the user's circles. Falls back to 0 when there's nothing yet.
	const paidCircles = data.circles.filter((c) => c.contributed_this_cycle).length;
	const totalCircles = Math.max(data.circles_total, 1);
	const progressPct = Math.min(
		100,
		Math.round((paidCircles / totalCircles) * 100),
	);

	// Total people across the user's circles (for the "+N People" chip).
	const totalPeople = data.circles.reduce((sum, c) => sum + (c.member_count ?? 0), 0);

	const due = data.quick_deposit;

	return (
		<div className="space-y-4">
			<div className="rounded-[20px] bg-primary p-5 text-white md:p-6">
				<div className="flex items-start justify-between gap-4">
					<div className="min-w-0">
						{/* NOT the withdrawable balance — this is contributed minus what
						    has rotated back, so it goes DOWN on a payout. The Saji Balance
						    card on the wallet page owns "what can I withdraw". */}
						<p className="text-[10px] md:text-sm">Saving in Circles</p>
						<div className="mt-1 flex items-center gap-2.5">
							<h3 className="truncate text-[32px] font-medium md:text-[44px]">
								{hidden ? "*******" : formatMoney(data.saved_balance, data.asset_code)}
							</h3>
							<button
								type="button"
								onClick={() => setHidden((h) => !h)}
								className="text-xl"
								tabIndex={-1}
							>
								{hidden ? <IoEyeOff /> : <IoEye />}
							</button>
						</div>
						<p className="mt-1 text-[10px] font-light text-white/80 md:text-xs">
							Your contributions still working in your circles
						</p>
						{/* Member/people count across the user's circles. */}
						<div className="mt-2 flex items-center gap-2">
							<div className="h-6">
								<img src={AVATARS} alt="members" className="h-full" />
							</div>
							<span className="text-[10px] md:text-xs">
								+{totalPeople} People
							</span>
						</div>
					</div>
					<Button
						href={pageRoutes.dashboardRoutes.WALLET}
						className="bg-primary-dark"
						size="sm"
					>
						<span>Quick Deposit</span>
						<HiOutlinePlusSmall className="scale-125" />
					</Button>
				</div>

				{/* Circle progress */}
				<div className="mt-6">
					<div className="flex items-center justify-between text-[10px] md:text-xs">
						<span>Circle Progress</span>
						<span>{progressPct}%</span>
					</div>
					<div className="mt-1.5 h-1.5 rounded-full bg-primary-dark">
						<div
							className="h-1.5 rounded-full bg-white transition-all"
							style={{ width: `${progressPct}%` }}
						/>
					</div>
				</div>

			</div>

			{/* Amount-due banner (only when something is due) */}
			{due && (
				<Link
					href={pageRoutes.dashboardRoutes.GROUP(String(due.group_id))}
					className="block rounded-2xl bg-[#efeaff] px-4 py-3 md:px-6 md:py-4"
				>
					<p className="text-sm font-medium text-primary">
						{Number(due.amount).toLocaleString()} {due.asset_code} due
						{due.due_at ? ` ${dueInLabel(due.due_at)}` : ""}
					</p>
					<p className="text-xs font-light text-primary/70">
						Contribute to “{due.group_name}” to stay on track this cycle.
					</p>
				</Link>
			)}
		</div>
	);
}

/** "in 3 days" / "today" / "2 days ago" from an ISO date. */
function dueInLabel(iso: string): string {
	const days = Math.round(
		(new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
	);
	if (days === 0) return "today";
	if (days > 0) return `in ${days} day${days === 1 ? "" : "s"}`;
	return `${Math.abs(days)} day${days === -1 ? "" : "s"} ago`;
}
