"use client";
import React from "react";
import { HiOutlineArchiveBox, HiOutlineBuildingLibrary } from "react-icons/hi2";
import { PiGlobeLight } from "react-icons/pi";
import GoBack from "../../components/dashboard/GoBack";
import { pageRoutes } from "../../config/routes";
import ProfileMenuList from "./ProfileMenuList";

export default function WithdrawalInfoView() {
	return (
		<div className="mx-auto md:max-w-xl lg:max-w-2xl w-full px-0 sm:px-4 py-2">
			<div className="space-y-6">
				<GoBack />

				<h2 className="text-xl font-semibold text-neutral-dark">Withdrawal Info</h2>

				<ProfileMenuList
					items={[
						{
							key: "bank-info",
							icon: <HiOutlineBuildingLibrary />,
							label: "Bank Info",
							href: pageRoutes.dashboardRoutes.PROFILE_WITHDRAWAL_BANK_INFO,
						},
						{
							key: "wallet-address",
							icon: <PiGlobeLight />,
							label: "Wallet Address",
							href: pageRoutes.dashboardRoutes.PROFILE_WITHDRAWAL_WALLET_ADDRESS,
						},
						{
							key: "saved-accounts",
							icon: <HiOutlineArchiveBox />,
							label: "Saved Accounts",
							href: pageRoutes.dashboardRoutes.PROFILE_WITHDRAWAL_SAVED_ACCOUNTS,
						},
					]}
				/>
			</div>
		</div>
	);
}
