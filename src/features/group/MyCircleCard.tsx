/* eslint-disable @next/next/no-img-element */
import Image from "next/image";
import React from "react";
import { Button } from "../../components/ui/button";
import { getProgressStyle } from "../../lib/utils/progress-style";
import { CircleGroup } from "../../lib/utils/mock-data";

const statusStyles: Record<CircleGroup["status"], string> = {
	PAID: "bg-success-50 text-success-700",
	PENDING: "bg-warning-100 text-warning-800",
	OVERDUE: "bg-error-50 text-error-500",
};

interface MyCircleCardProps {
	circle: CircleGroup;
}

const formatAmount = (value: number) => `$${value.toLocaleString()}`;

const MyCircleCard = ({ circle }: MyCircleCardProps) => {
	const {
		title,
		subtitle,
		image,
		current,
		target,
		status,
		nextPayoutDate,
		memberCount,
		memberAvatarsImage,
	} = circle;

	const progressPercent = Math.min(100, Math.round((current / target) * 100));
	const progressStyle = getProgressStyle(progressPercent);

	return (
		<div className="bg-[#f8f8f8] rounded-xl py-2 px-3 md:py-5 md:px-6 space-y-2.5 md:space-y-3 border border-[#f8f8f8] hover:border-accent duration-200 cursor-pointer">
			<div className="flex justify-between items-start">
				<div className="max-md:hidden mb-9 flex items-center gap-2.5">
					<div className="rounded-full h-15 w-15 overflow-hidden">
						<Image
							alt="Group Image"
							src={image}
							height={300}
							width={300}
							className="h-full w-full object-cover"
						/>
					</div>
					<div>
						<h6 className="text-xs">TARGET</h6>
						<div className="text-xs md:text-base">
							{formatAmount(current)} / {formatAmount(target)}
						</div>
					</div>
				</div>
				<div
					className={`rounded-[33px] px-3 py-2.25 text-xs max-md:hidden ${statusStyles[status]}`}
				>
					{status}
				</div>
			</div>
			<div className="flex justify-between gap-4">
				<h5 className="flex flex-col">
					<span className="text-xs sm:text-base md:text-xl lg:text-2xl">
						{title}
					</span>
					<span className="text-xs max-md:hidden">{subtitle}</span>
				</h5>
				<div className="flex items-center gap-1 md:hidden">
					<div className="h-4">
						<img src={memberAvatarsImage} className="h-full" alt="" />
					</div>
					<div className="text-[10px] ssm:text-xs md:text-sm md:hidden">
						{memberCount} Members
					</div>
				</div>
			</div>
			<div className="flex items-center justify-between gap-2">
				<div className="h-1.25 bg-neutral-light rounded-[900px] md:h-1.75 flex-1">
					<div
						className={`${progressStyle.barColor} rounded-[900px] h-1.25 md:h-1.75 transition-all`}
						style={{ width: `${progressPercent}%` }}
					></div>
				</div>
				{/* <span
					className={`hidden md:inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ${progressStyle.badgeBg} ${progressStyle.badgeText}`}
				>
					{progressStyle.label}
				</span> */}
			</div>
			{/*  */}
			<div className="flex items-center justify-between gap-4 md:hidden">
				<div className="flex items-center gap-1 ">
					<svg
						width="8"
						height="11"
						viewBox="0 0 8 11"
						fill="none"
						xmlns="http://www.w3.org/2000/svg"
					>
						<path
							d="M5.77905 2.42122C6.45143 2.7935 6.9769 3.41528 7.21752 4.18489L7.85424 6.22396C8.46969 8.19329 6.99866 10.1947 4.9353 10.1947H3.0603C0.997102 10.1944 -0.474066 8.19319 0.141352 6.22396L0.778071 4.18489C1.01866 3.41532 1.54424 2.79353 2.21655 2.42122H5.77905ZM3.9978 3.61556C3.88297 3.61562 3.78979 3.70873 3.78979 3.82357V4.39681C3.22905 4.48387 2.77044 4.91574 2.77026 5.47982C2.77037 6.11244 3.34695 6.58035 3.9978 6.5804C4.47284 6.58042 4.80922 6.91153 4.80932 7.264C4.80921 7.61645 4.47284 7.94855 3.9978 7.94857C3.5228 7.94851 3.18639 7.61644 3.18627 7.264C3.18619 7.14919 3.09309 7.05599 2.97827 7.05599C2.8635 7.05605 2.77035 7.14923 2.77026 7.264C2.77036 7.82814 3.22901 8.25993 3.78979 8.347V8.92122C3.79015 9.03576 3.88319 9.12819 3.9978 9.12825C4.11243 9.12823 4.20545 9.03578 4.20581 8.92122V8.347C4.76659 8.25993 5.22524 7.82814 5.22534 7.264C5.22524 6.63134 4.64868 6.16441 3.9978 6.16439C3.5228 6.16433 3.18639 5.83226 3.18627 5.47982C3.18649 5.12743 3.52286 4.79627 3.9978 4.79622C4.47277 4.79624 4.80911 5.12742 4.80932 5.47982C4.80942 5.59457 4.90256 5.68776 5.01733 5.68782C5.13211 5.68778 5.22524 5.59458 5.22534 5.47982C5.22516 4.91573 4.76657 4.48385 4.20581 4.39681V3.82357C4.20581 3.7087 4.11265 3.61558 3.9978 3.61556ZM4.63647 0.0559876C5.62809 -0.263885 6.42615 0.856231 5.83373 1.65657H2.16186C1.56973 0.856315 2.3677 -0.263572 3.35913 0.0559876L3.83178 0.209308C3.93945 0.244039 4.05614 0.244034 4.16381 0.209308L4.63647 0.0559876Z"
							fill="#4100F4"
						/>
					</svg>

					<span className="text-[10px] sm:text-sm ">
						Next Payout: {nextPayoutDate}
					</span>
				</div>
				<div className="text-xs sm:text-sm md:text-base ">
					{current.toLocaleString()} / {target.toLocaleString()}
				</div>
			</div>
			{/*  */}
			<div className="flex justify-between items-center mt-18 gap-4 max-md:hidden">
				<div>
					<h6 className="text-xs mb-2">MEMBERS</h6>
					<div className="flex items-center gap-2 flex-wrap">
						<div className="h-8.5">
							<img src={memberAvatarsImage} className="h-full" alt="" />
						</div>
						<div className="whitespace-nowrap max-lg:text-sm">
							{memberCount} Members
						</div>
					</div>
				</div>
				<Button variant="dark" className="">
					View Details
				</Button>
			</div>
		</div>
	);
};

export default MyCircleCard;
