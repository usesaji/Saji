/* eslint-disable @next/next/no-img-element */
"use client";
import React, { useState } from "react";
import { IoEye, IoEyeOff } from "react-icons/io5";
import { HiOutlineMinusSmall, HiOutlinePlusSmall } from "react-icons/hi2";
import { Button } from "../../components/ui/button";
import { pageRoutes } from "../../config/routes";

interface WalletHeroCardProps {
	label?: string;
	amount?: string;
	memberCount?: number;
	memberAvatarsImage?: string;
}

export default function WalletHeroCard({
	label = "Total Group Savings",
	amount = "₦12,450.80",
	memberCount = 23,
	memberAvatarsImage = "/images/review-user-imgs.png",
}: WalletHeroCardProps) {
	const [view, setView] = useState(true);

	const handleView = () => setView((prev) => !prev);

	return (
		<div className="bg-primary text-white rounded-[20px] p-5 md:p-7 flex flex-col md:flex-row md:items-center gap-6 md:gap-10 relative overflow-hidden">
			<img
				src="/images/wallet-vector.svg"
				alt=""
				className="absolute -bottom-5 -right-3 md:scale-[2] md:right-0 md:bottom-0"
			/>
			<img
				src="/images/wallet-flower.svg"
				alt=""
				className="absolute bottom-0 right-10 max-md:hidden"
			/>

			<div className="min-w-0 md:flex-1">
				<p className="text-[10px] md:text-sm">{label}</p>

				<div className="flex items-center gap-2.5 mt-1 min-w-0">
					{view ? (
						<h3 className="font-medium text-[36px] truncate max-w-full md:text-[48px]">
							{amount}
						</h3>
					) : (
						<h3 className="font-medium text-[40px]">*******</h3>
					)}

					<button
						type="button"
						onClick={handleView}
						className="text-xl"
						tabIndex={-1}
					>
						{view ? <IoEyeOff /> : <IoEye />}
					</button>
				</div>

				<div className="flex items-center gap-2 mt-3">
					<img src={memberAvatarsImage} alt="" className="h-6.5" />
					<span className="text-xs md:text-sm">{memberCount}+ People</span>
				</div>
			</div>

			<div className="relative flex max-md:flex-col gap-3">
				<Button
					href={pageRoutes.dashboardRoutes.WALLET_ADD_MONEY}
					className="bg-primary-dark w-full md:w-fit"
				>
					<span>Quick Deposit</span>
					<HiOutlinePlusSmall className="scale-[1.3]" />
				</Button>
				<Button
					variant="secondary"
					href={pageRoutes.dashboardRoutes.WALLET_WITHDRAW}
					className=" w-full md:w-fit"
				>
					<span>Withdraw</span>
					<HiOutlineMinusSmall className="scale-[1.3]" />
				</Button>
			</div>
		</div>
	);
}
