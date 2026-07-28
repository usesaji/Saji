"use client";
import React, { useState } from "react";
import { IoEye, IoEyeOff } from "react-icons/io5";

export default function GroupStats() {
	const stats = [
		{
			title: "Total Savings",
			value: "$24,500,000",
			color: "bg-primary",
		},
		{
			title: "Total Pending",
			value: "$400,000",
			color: "bg-accent",
		},
		{
			title: "Active Groups",
			value: "20",
			color: "bg-secondary-dark",
		},
	];

	return (
		<section className="flex space-x-1.75 md:gap-2.5 mt-5 overflow-x-auto hide-scroll">
			{stats.map((s, i) => (
				<StatsCard key={i} color={s.color} title={s.title} value={s.value} />
			))}
		</section>
	);
}

function StatsCard({
	color,
	title,
	value,
}: {
	color: string;
	title: string;
	value: string;
}) {
	const [view, setView] = useState(true);

	const handleView = () => {
		setView((prev) => !prev);
	};

	return (
		<div
			className={`${color} text-white rounded-[10.55px] px-3 pt-3 pb-4 md:px-4 md:pt-4 md:pb-5 min-w-50 md:min-w-80 lg:min-w-2/5 min-h-18 md:min-h-25  w-full`}
		>
			<h5 className="text-xs font-light md:text-sm">{title}</h5>
			<div className="flex items-center gap-2.5 mt-0.5 min-w-0">
				{view ? (
					<h3 className="font-medium text-[22px] truncate max-w-full md:text-[32px] xl:text-[48px]">
						{value}
					</h3>
				) : (
					<h3 className="font-medium text-[22px] md:text-[36px]">*******</h3>
				)}

				<button
					type="button"
					onClick={handleView}
					className="text-xl "
					tabIndex={-1}
				>
					{view ? <IoEyeOff /> : <IoEye />}
				</button>
			</div>
		</div>
	);
}
