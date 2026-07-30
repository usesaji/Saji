/* eslint-disable @next/next/no-img-element */
"use client";
import React, { useState } from "react";
import { IoEye, IoEyeOff } from "react-icons/io5";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "../../components/ui/select";
import { currencies } from "../../lib/utils";
import { Button } from "../../components/ui/button";
import { pageRoutes } from "../../config/routes";
import { HiOutlinePlusSmall } from "react-icons/hi2";

export const WalletCard = () => {
	const [view, setView] = useState(true);
	const [currency, setCurrency] = useState<string | null>("USDC");

	const handleView = () => {
		setView((prev) => !prev);
	};

	return (
		<div className="bg-primary text-white rounded-[20px] p-5 flex relative flex-col gap-11 overflow-hidden ">
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
			<div className="flex justify-between flex-col">
				<div className="flex items-end justify-between">
					<p className="text-[10px] md:text-sm">$USDC Group Savings </p>
					<div className="max-[340px]:place-self-end">
						<Select
							items={currencies}
							value={currency}
							onValueChange={setCurrency}
						>
							<SelectTrigger className="w-20 h-8.5 md:w-24  rounded-[31.17px] border-0 bg-primary-dark text-xs md:text-base">
								<SelectValue placeholder="USDC" />
							</SelectTrigger>
							<SelectContent
								align="end"
								className="bg-white text-neutral-dark ring-0"
							>
								<SelectGroup>
									{currencies.map((item) => (
										<SelectItem key={item.value} value={item.value}>
											{item.label}
										</SelectItem>
									))}
								</SelectGroup>
							</SelectContent>
						</Select>
					</div>
				</div>
				<div className="flex items-center gap-2.5 mt-1 min-w-0">
					{view ? (
						<h3 className="font-medium text-[36px] truncate max-w-full md:text-[48px]">
							$2,450,000.80
						</h3>
					) : (
						<h3 className="font-medium text-[40px]">*******</h3>
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
			<div className="">
				<Button
					href={pageRoutes.dashboardRoutes.WALLET_ADD_MONEY}
					className="bg-primary-dark w-full max-w-40"
				>
					<span>Quick Deposit</span>
					<HiOutlinePlusSmall className="scale-[1.3]" />
				</Button>
			</div>
		</div>
	);
};
