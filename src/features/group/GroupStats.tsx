"use client";
import React, { useState } from "react";
import { IoEye, IoEyeOff } from "react-icons/io5";
import { useApi } from "../../lib/hooks/useApi";
import { dashboard as dashboardApi } from "../../lib/api";
import { formatMoney } from "../../lib/utils";

export default function GroupStats() {
	const { data, loading } = useApi(() => dashboardApi.show(), []);

	// Real figures from the user home dashboard. "Total Pending" is the amount
	// currently due (quick_deposit), which is the only pending figure the
	// dashboard exposes; falls back to — when nothing is owed.
	const quickDeposit = data?.quick_deposit ?? null;

	const activeGroups = data?.circles_total ?? 0;

	const stats = [
		{
			title: "Total Saved",
			value: loading ? "…" : formatMoney(data?.saved_balance, data?.asset_code),
			color: "bg-primary",
			hideable: true,
		},
		{
			title: "Total Pending",
			value: loading ? "…" : formatMoney(quickDeposit?.amount ?? null, quickDeposit?.asset_code),
			color: "bg-accent",
			hideable: true,
		},
		{
			title: "Active Groups",
			value: loading ? "…" : `${activeGroups} Group${activeGroups === 1 ? "" : "s"}`,
			color: "bg-secondary-dark",
			hideable: false,
		},
	];

	return (
		<section className="mt-5 grid grid-cols-2 gap-2.5 md:grid-cols-3 md:gap-4">
			{stats.map((s, i) => (
				<StatsCard
					key={i}
					color={s.color}
					title={s.title}
					value={s.value}
					hideable={s.hideable}
				/>
			))}
		</section>
	);
}

function StatsCard({
	color,
	title,
	value,
	hideable = true,
}: {
	color: string;
	title: string;
	value: string;
	hideable?: boolean;
}) {
	const [view, setView] = useState(true);

	return (
		<div
			className={`${color} min-h-20 w-full rounded-2xl px-4 pt-3 pb-4 text-white md:min-h-24 md:pt-4 md:pb-5`}
		>
			<h5 className="text-xs font-light md:text-sm">{title}</h5>
			<div className="mt-0.5 flex min-w-0 items-center gap-2">
				<h3 className="max-w-full truncate text-xl font-medium md:text-2xl xl:text-[28px]">
					{hideable && !view ? "*******" : value}
				</h3>
				{hideable && (
					<button
						type="button"
						onClick={() => setView((v) => !v)}
						className="text-lg"
						tabIndex={-1}
					>
						{view ? <IoEyeOff /> : <IoEye />}
					</button>
				)}
			</div>
		</div>
	);
}
