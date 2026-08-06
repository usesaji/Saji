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
import { useTotalSavings } from "../../lib/hooks/useTotalSavings";
import { fromStroops } from "../../lib/stroops";

const AVATARS = "/images/review-user-imgs.png";

/**
 * The dashboard hero: everything the user's money adds up to, plus the
 * "amount due" banner.
 *
 * The headline is TOTAL WORTH — withdrawable (claimable payouts + wallet) plus
 * what is still working in circles — because that is what "what have I got"
 * means. Neither half answers it alone: money-in-circles goes DOWN when you are
 * paid and hits zero once a circle completes (an account that worked perfectly
 * looks empty), while withdrawable-only reads zero for anyone mid-cycle who has
 * contributed and isn't owed a payout yet.
 *
 * A circle saves in exactly ONE token, so a user can hold several currencies at
 * once. Rather than stack them or convert (an exchange rate would go stale, and
 * a savings figure that moves with the market is its own problem), the card
 * shows ONE token at a time behind a toggle.
 */
export default function SavingsSummaryCard({ data }: { data: DashboardData }) {
	const [hidden, setHidden] = useState(false);
	/** Token the user picked, or null to follow the largest holding. */
	const [picked, setPicked] = useState<string | null>(null);

	// Circle progress: a rough sense of activity — cycles paid this period across
	// the user's circles. Falls back to 0 when there's nothing yet.
	const paidCircles = data.circles.filter((c) => c.contributed_this_cycle).length;
	const totalCircles = Math.max(data.circles_total, 1);
	const progressPct = Math.min(
		100,
		Math.round((paidCircles / totalCircles) * 100),
	);

	const total = useTotalSavings(data);
	const assets = total.assets;

	// Resolved against the live list rather than trusted directly: an asset can
	// disappear between renders (you withdrew all of it), and a stale code would
	// otherwise leave the card showing that token with a blank figure.
	const shown =
		assets.find((a) => a.asset_code === picked) ?? total.headline ?? null;

	// Distinct OTHER people, from the backend — not summed over `circles`, which
	// is capped at 5 and would double-count anyone in two of them.
	const totalPeople = data.people_total ?? 0;

	const due = data.quick_deposit;

	const hasCircles = data.circles_total > 0;
	// The subtitle names WHERE the money is, so the headline is never ambiguous
	// about whether it can be spent. With nothing at all, it has to tell apart a
	// brand-new user from one whose circles have simply completed — "start
	// saving" would be wrong for someone who already has.
	const subtitle = (() => {
		if (total.error) return "Couldn't reach the network to read your balance";
		if (!total.hasAnything) {
			return hasCircles
				? "All caught up — your contributions have rotated back to you"
				: "Join or create a circle to start saving";
		}
		const parts: string[] = [];
		if (total.withdrawableTotalAcrossAssets > 0n) parts.push("ready to withdraw");
		if (total.inCirclesTotalAcrossAssets > 0n) parts.push("working in your circles");
		return parts.join(" · ");
	})();

	return (
		<div className="space-y-4">
			<div className="rounded-[20px] bg-primary p-5 text-white md:p-6">
				<div className="flex items-start justify-between gap-4">
					<div className="min-w-0">
						<p className="text-[10px] md:text-sm">Your Savings</p>
						<div className="mt-1 flex items-center gap-2.5">
							<h3 className="truncate text-[32px] font-medium md:text-[44px]">
								{hidden
									? "*******"
									: total.loading && !shown
										? "…"
										: formatMoney(
												fromStroops(shown?.total ?? 0n),
												shown?.asset_code ?? data.asset_code,
											)}
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

						{/* Where THIS token's money sits. Withdrawable and locked behave
						    differently — one is spendable now, the other is released by the
						    rotation — so the split stays visible rather than collapsing
						    into the headline. */}
						{!hidden && shown && shown.total > 0n && (
							<p className="mt-1 text-[11px] font-light text-white/90 md:text-sm">
								{[
									shown.withdrawable > 0n
										? `${formatMoney(fromStroops(shown.withdrawable), shown.asset_code)} ready`
										: null,
									shown.inCircles > 0n
										? `${formatMoney(fromStroops(shown.inCircles), shown.asset_code)} in circles`
										: null,
								]
									.filter(Boolean)
									.join(" · ")}
							</p>
						)}

						<p className="mt-1 text-[10px] font-light text-white/80 md:text-xs">
							{subtitle}
						</p>

						{/* People the user saves with. Omitted entirely when there are
						    none — "+0 People" beside a row of avatars reads as broken
						    rather than as "you're saving alone". */}
						{totalPeople > 0 && (
							<div className="mt-2 flex items-center gap-2">
								<div className="h-6">
									<img src={AVATARS} alt="members" className="h-full" />
								</div>
								<span className="text-[10px] md:text-xs">
									+{totalPeople} {totalPeople === 1 ? "Person" : "People"}
								</span>
							</div>
						)}
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

				{/* Token toggle — only when there is more than one to switch between.
				    A single chip would be decoration, and none at all is the empty
				    state. Hidden under the privacy toggle since the chips carry
				    balances themselves. */}
				{!hidden && assets.length > 1 && (
					<div className="mt-4 flex flex-wrap gap-2">
						{assets.map((a) => {
							const active = a.asset_code === shown?.asset_code;
							return (
								<button
									key={a.asset_code}
									type="button"
									aria-pressed={active}
									onClick={() => setPicked(a.asset_code)}
									className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors md:text-xs ${
										active
											? "bg-white text-primary"
											: "bg-primary-dark text-white/80 hover:text-white"
									}`}
								>
									{a.asset_code}
								</button>
							);
						})}
					</div>
				)}

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
