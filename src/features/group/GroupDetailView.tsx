"use client";
import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FiStar } from "react-icons/fi";
import { HiOutlineLockClosed } from "react-icons/hi2";
import { IoEye, IoEyeOff } from "react-icons/io5";
import { PiInfoLight } from "react-icons/pi";
import { Button } from "../../components/ui/button";
import { pageRoutes } from "../../config/routes";
import { getProgressStyle } from "../../lib/utils/progress-style";
import { CircleGroup } from "../../lib/utils/mock-data";
import { mockTransactions } from "../../lib/utils/mock-transactions";
import ActivityCard from "../activity/ActivityCard";
import MemberAvatar from "./MemberAvatar";

const formatCurrency = (value: number) =>
	`₦${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface GroupDetailViewProps {
	group: CircleGroup;
	isOwner: boolean;
}

export default function GroupDetailView({ group, isOwner }: GroupDetailViewProps) {
	const router = useRouter();
	const [view, setView] = useState(true);

	const handleViewTransaction = (tx: { id: string }) => {
		router.push(`${pageRoutes.dashboardRoutes.ACTIVITY}?tx=${tx.id}`);
	};

	const progressPercent = Math.min(100, Math.round((group.current / group.target) * 100));
	const progressStyle = getProgressStyle(progressPercent);

	// Cycle activity is demo content shared across groups; one group is
	// deliberately kept empty so the "No Activity yet" state is reachable.
	const cycleActivity = group.id === "circle-3" ? [] : mockTransactions.slice(0, 2);

	return (
		<div className="mt-4 md:mt-6">
			<h2 className="text-xl md:text-3xl">{group.title}</h2>

			{/* Balance + Progress */}
			<div className="bg-neutral-comment rounded-[20px] p-5 mt-3 md:mt-5">
				<div className="flex items-center justify-between gap-3">
					<p className="text-xs font-light text-neutral-light-active">
						Total Group Savings
					</p>
					<div className="h-7 flex items-center gap-1.5 shrink-0">
						<img
							src={group.memberAvatarsImage}
							alt="Group members"
							className="h-full"
						/>
					</div>
				</div>

				<div className="flex items-center gap-2.5 mt-1 min-w-0">
					{view ? (
						<h3 className="font-medium text-3xl md:text-4xl truncate max-w-full">
							{formatCurrency(group.current)}
						</h3>
					) : (
						<h3 className="font-medium text-3xl md:text-4xl">*******</h3>
					)}
					<button
						type="button"
						onClick={() => setView((prev) => !prev)}
						className="text-lg cursor-pointer bg-transparent border-0"
						tabIndex={-1}
					>
						{view ? <IoEyeOff /> : <IoEye />}
					</button>
				</div>

				<div className="mt-4">
					<div className="flex items-center justify-between text-xs mb-1.5">
						<span className="flex items-center gap-1.5 text-neutral-light-active">
							<HiOutlineLockClosed className="text-primary" />
							Circle Progress
						</span>
						<span className="font-medium text-neutral-dark">
							₦{group.current.toLocaleString()} / ₦{group.target.toLocaleString()}
						</span>
					</div>
					<div className="h-1.75 bg-neutral-light rounded-[900px]">
						<div
							className={`${progressStyle.barColor} rounded-[900px] h-1.75 transition-all`}
							style={{ width: `${progressPercent}%` }}
						/>
					</div>
				</div>
			</div>

			{/* Contribution due banner */}
			{group.contributionAmount > 0 && (
				<div className="bg-primary-light rounded-[20px] p-5 mt-4">
					<h4 className="text-sm font-semibold text-primary-darker">
						₦{group.contributionAmount.toLocaleString()}.00 Due in{" "}
						{group.contributionDueInDays} days
					</h4>
					<p className="text-xs font-light text-primary-dark mt-1.5 leading-relaxed">
						Your monthly group contribution of ₦{group.contributionAmount.toLocaleString()}
						.00 is due in {group.contributionDueInDays} days. Ensure you leave enough
						balance to avoid missed payment penalties.
					</p>
				</div>
			)}

			{/* Payout Rotation */}
			<section className="mt-6">
				<div className="flex items-center justify-between">
					<h3 className="text-base md:text-lg font-semibold text-neutral-dark">
						Payout Rotation
					</h3>
					<Link
						href={pageRoutes.dashboardRoutes.GROUP_ROTATION(group.id)}
						className="flex items-center gap-1 text-xs md:text-sm text-primary hover:text-primary-hover"
					>
						View All
						<span aria-hidden>→</span>
					</Link>
				</div>

				<div className="flex items-start gap-4 mt-4 overflow-x-auto hide-scroll">
					{group.payoutRotation.slice(0, 5).map((member, index) => (
						<div
							key={member.id}
							className="flex flex-col items-center gap-1.5 shrink-0 w-16"
						>
							<div className="relative">
								<MemberAvatar
									name={member.name}
									isSelf={member.isSelf}
									colorIndex={index}
									size="w-13 h-13"
								/>
								{index === 0 && (
									<span className="absolute -top-0.5 -right-0.5 w-4.5 h-4.5 rounded-full bg-primary flex items-center justify-center border-2 border-white">
										<FiStar className="text-white text-[8px]" fill="white" />
									</span>
								)}
							</div>
							<p className="text-[11px] font-medium text-neutral-dark text-center truncate w-full">
								{member.name}
							</p>
							<p className="text-[10px] text-neutral-light-active text-center">
								{index === 0 ? "Current" : "Next Cycle"}
							</p>
						</div>
					))}
				</div>
			</section>

			{/* Cycle Activity */}
			<section className="mt-6">
				<h3 className="text-base md:text-lg font-semibold text-neutral-dark">
					Cycle Activity
				</h3>

				{cycleActivity.length > 0 ? (
					<div className="space-y-3 mt-4">
						{cycleActivity.map((tx) => (
							<ActivityCard key={tx.id} tx={tx} onViewDetails={handleViewTransaction} />
						))}
					</div>
				) : (
					<div className="flex flex-col items-center justify-center gap-2 py-12 mt-4 rounded-[15px] border border-dashed border-neutral-light-hover">
						<PiInfoLight className="text-2xl text-neutral-light-active" />
						<p className="text-xs font-light text-neutral-light-active">
							No Activity yet
						</p>
					</div>
				)}
			</section>

			{/* Actions */}
			<div className="flex flex-wrap gap-3 mt-8">
				<Button
					href={pageRoutes.dashboardRoutes.GROUP_CONTRIBUTE(group.id)}
					className="bg-primary hover:bg-primary-hover text-white"
				>
					Pay Now
				</Button>
				{isOwner && (
					<Button
						href={pageRoutes.dashboardRoutes.GROUP_INVITE(group.id)}
						className="bg-accent-light hover:bg-accent-light-hover text-accent"
					>
						Invite Members
					</Button>
				)}
			</div>
		</div>
	);
}
