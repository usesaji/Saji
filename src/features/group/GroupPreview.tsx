/* eslint-disable @next/next/no-img-element */
"use client";
import Image from "next/image";
import React, { useState } from "react";
import { FaCalendarCheck } from "react-icons/fa";
import { HiMiniUsers } from "react-icons/hi2";
import { RiMoneyDollarCircleFill } from "react-icons/ri";
import { PiLockLight, PiWarningCircleFill } from "react-icons/pi";
import { Button } from "../../components/ui/button";
import { CircleGroup } from "../../lib/utils/mock-data";
import { useGroupMembershipStore } from "../../lib/store/group-membership-store";

interface GroupPreviewProps {
	group: CircleGroup;
}

const formatCurrency = (value: number) =>
	`$${value.toLocaleString(undefined, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`;

export default function GroupPreview({ group }: GroupPreviewProps) {
	const joinGroup = useGroupMembershipStore((state) => state.joinGroup);
	const [isJoining, setIsJoining] = useState(false);

	const {
		id,
		title,
		bannerImage,
		target,
		memberCount,
		memberAvatarsImage,
		groupType,
		payoutOrder,
		frequency,
		latePenaltyLabel,
		joinMessage,
		visibility,
	} = group;

	const handleJoin = () => {
		setIsJoining(true);
		setTimeout(() => {
			joinGroup(id);
		}, 1200);
	};

	return (
		<div className="mt-4 md:mt-6">
			<div className="flex items-center gap-3">
				<h2 className="text-xl md:text-3xl">{title}</h2>
				<span
					className={`text-[10px] font-medium rounded-full px-2.5 py-1 ${
						visibility === "private"
							? "bg-neutral-comment text-neutral-light-active"
							: "bg-primary-light text-primary"
					}`}
				>
					{visibility === "private" ? "Private Group" : "Public Group"}
				</span>
			</div>

			<div className="rounded-2xl overflow-hidden h-36 mt-3 md:h-48 lg:h-52">
				<Image
					alt={`${title} Profile Picture`}
					src={bannerImage}
					width={800}
					height={800}
					className="h-full w-full object-cover"
				/>
			</div>

			<section className="mt-3 flex flex-col gap-2 md:flex-row md:mt-5 md:gap-4">
				<div className="bg-[#f7f7f7] rounded-2xl p-4 md:flex-1 md:p-6 min-w-0">
					<h5 className="text-xs font-light md:text-sm ">Target Goal</h5>
					<h3 className="font-medium text-2xl md:text-3xl lg:text-4xl truncate max-w-full mt-1 md:mt-2">
						{formatCurrency(target)}
					</h3>
				</div>

				<div className="bg-[#f7f7f7] rounded-2xl p-4 md:flex-1 md:p-6">
					<h5 className="text-xs font-light md:text-sm">
						{memberCount} Members
					</h5>
					<div className="h-10 mt-2 md:h-14">
						<img
							src={memberAvatarsImage}
							className="h-full"
							alt="Group members"
						/>
					</div>
				</div>
			</section>

			<section className="mt-5 md:mt-7">
				<h3 className="md:text-xl">Group Settings</h3>

				<div className="mt-3 space-y-3 md:mt-5 md:space-y-4">
					<div className="flex justify-between items-center border-b border-b-[#d9d9d9] pb-2">
						<div className="flex items-center gap-1 md:gap-2">
							<HiMiniUsers className="text-primary text-xl" />
							<p className="text-sm font-light md:text-base md:font-normal">
								Group Type
							</p>
						</div>
						<div className="text-sm md:text-base font-medium">{groupType}</div>
					</div>
					{/*  */}
					<div className="flex justify-between items-center border-b border-b-[#d9d9d9] pb-2">
						<div className="flex items-center gap-1 md:gap-2">
							<RiMoneyDollarCircleFill className="text-primary text-xl" />
							<p className="text-sm font-light md:text-base md:font-normal">
								Payout Order
							</p>
						</div>
						<div className="text-sm md:text-base font-medium">
							{payoutOrder}
						</div>
					</div>
					{/*  */}
					<div className="flex justify-between items-center border-b border-b-[#d9d9d9] pb-2">
						<div className="flex items-center gap-1 md:gap-2">
							<FaCalendarCheck className="text-primary text-base" />
							<p className="text-sm font-light md:text-base md:font-normal">
								Frequency
							</p>
						</div>
						<div className="text-sm md:text-base font-medium">{frequency}</div>
					</div>
					{/*  */}
					<div className="flex justify-between items-center pb-2">
						<div className="flex items-center gap-1 md:gap-2">
							<PiWarningCircleFill className="text-[#FF0000] text-xl" />
							<p className="text-sm font-light md:text-base md:font-normal">
								Late Penalty
							</p>
						</div>
						<div className="text-sm md:text-base font-medium">
							{latePenaltyLabel}
						</div>
					</div>
				</div>
			</section>

			<section className="mt-5">
				<div className="bg-[#f7f7f7] rounded-2xl p-4 md:p-6">
					<h5 className="text-base lg:text-xl md:font-medium flex items-center gap-2">
						{visibility === "private" && (
							<PiLockLight className="text-neutral-light-active" />
						)}
						Join the Others
					</h5>
					<p className="text-xs font-light md:text-sm mt-2 lg:text-base w-2/3">
						{visibility === "private"
							? "This is a private group. You'll need an invitation from the organizer to join, but you can preview it below."
							: joinMessage}
					</p>
					<div className="h-10 mt-4 md:h-14 md:mt-6">
						<img
							src={memberAvatarsImage}
							className="h-full"
							alt="Group members"
						/>
					</div>
				</div>

				<Button
					variant="secondary"
					className="mt-5 md:mt-7"
					onClick={handleJoin}
					isLoading={isJoining}
					disabled={isJoining}
				>
					Join Group
				</Button>
			</section>
		</div>
	);
}
