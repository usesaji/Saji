/* eslint-disable @next/next/no-img-element */
import Image from "next/image";
import React from "react";
import { FaCalendarCheck } from "react-icons/fa";
import { HiMiniUsers } from "react-icons/hi2";
import { RiMoneyDollarCircleFill } from "react-icons/ri";
import { PiWarningCircleFill } from "react-icons/pi";
import { Button } from "../../components/ui/button";
import { CircleGroup } from "../../lib/utils/mock-data";
import ImageUpload from "../../components/shared/ImageUpload";

const BANNER_PLACEHOLDER = "/images/group-test-img.png";

interface GroupPreviewProps {
	group: CircleGroup;
	/** When set (organizer only), the banner becomes uploadable. */
	onBannerUpload?: (file: File) => Promise<string>;
	/**
	 * Real values from the group's circle endpoint. When provided they replace
	 * the adapter's list-level approximations/placeholders (member count, payout
	 * order, etc.) with the actual figures. Omitted fields fall back to `group`.
	 */
	real?: {
		memberCount?: number;
		payoutOrder?: string;
		latePenalty?: string;
		groupType?: string;
	};
	/** Wire the "Join" button when an action exists; hidden otherwise. */
	onJoin?: () => void;
	joining?: boolean;
}

const formatCurrency = (value: number) =>
	`$${value.toLocaleString(undefined, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`;

export default function GroupPreview({
	group,
	onBannerUpload,
	real,
	onJoin,
	joining,
}: GroupPreviewProps) {
	const {
		title,
		bannerImage,
		target,
		memberAvatarsImage,
		frequency,
		joinMessage,
	} = group;

	// Prefer real circle data over the adapter's list-level placeholders.
	const memberCount = real?.memberCount ?? group.memberCount;
	const groupType = real?.groupType ?? group.groupType;
	const payoutOrder = real?.payoutOrder ?? group.payoutOrder;
	const latePenaltyLabel = real?.latePenalty ?? group.latePenaltyLabel;

	return (
		<div className="mt-4 md:mt-6">
			<h2 className="text-xl md:text-3xl">{title}</h2>

			{onBannerUpload ? (
				// Organizer can replace the banner in place.
				<div className="mt-3">
					<ImageUpload
						variant="banner"
						src={bannerImage}
						placeholder={BANNER_PLACEHOLDER}
						alt={`${title} banner`}
						onUpload={onBannerUpload}
					/>
				</div>
			) : (
				<div className="rounded-2xl overflow-hidden h-36 mt-3 md:h-48 lg:h-52">
					<Image
						alt={`${title} Profile Picture`}
						src={bannerImage}
						width={800}
						height={800}
						className="h-full w-full object-cover"
					/>
				</div>
			)}

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
								Late Penalty{" "}
								<span className="font-light opacity-60">(group rule)</span>
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
					<h5 className="text-base lg:text-xl md:font-medium">
						Join the Others
					</h5>
					<p className="text-xs font-light md:text-sm mt-2 lg:text-base w-2/3">
						{joinMessage}
					</p>
					<div className="h-10 mt-4 md:h-14 md:mt-6">
						<img
							src={memberAvatarsImage}
							className="h-full"
							alt="Group members"
						/>
					</div>
				</div>

				{onJoin && (
					<Button
						variant="secondary"
						className="mt-5 md:mt-7"
						onClick={onJoin}
						isLoading={joining}
					>
						Join Group
					</Button>
				)}
			</section>
		</div>
	);
}
