/* eslint-disable @next/next/no-img-element */
"use client";
import React, { useCallback, useEffect, useState } from "react";
import { IoEye, IoEyeOff } from "react-icons/io5";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "../../components/ui/select";
import { currencies, formatMoney } from "../../lib/utils";
import { Button } from "../../components/ui/button";
import { HiOutlinePlusSmall } from "react-icons/hi2";
import { useApi } from "../../lib/hooks/useApi";
import { profile as profileApi } from "../../lib/api";
import { currentAddress, walletBalances } from "../../lib/wallet";
import { pageRoutes } from "../../config/routes";

export const WalletCard = () => {
	const [view, setView] = useState(true);
	const [currency, setCurrency] = useState<string | null>("USDC");

	// Linked wallet address (drives whether we can show a balance).
	const { data: me } = useApi(useCallback(() => profileApi.show(), []), []);
	const linkedAddress = me?.stellar_address ?? null;

	// Balances read CLIENT-SIDE from Horizon (the backend read is blocked by the
	// DNS wall and returns 0). Keyed by asset code: { XLM, USDC, USDT }.
	const [balances, setBalances] = useState<Record<string, number> | null>(null);
	useEffect(() => {
		let cancelled = false;
		(async () => {
			const addr = (await currentAddress()) ?? linkedAddress;
			if (!addr) return;
			const bals = await walletBalances(addr);
			if (!cancelled) setBalances(bals);
		})();
		return () => {
			cancelled = true;
		};
	}, [linkedAddress]);

	const handleView = () => {
		setView((prev) => !prev);
	};

	// Headline: prompt to link when no wallet; the selected currency's live
	// balance otherwise (0 if the wallet holds none of that asset).
	const selectedCode = currency ?? "USDC";
	const balanceText = !linkedAddress
		? "Link wallet"
		: balances === null
			? "…"
			: formatMoney(String(balances[selectedCode] ?? 0));

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
					<p className="text-[10px] md:text-sm">
						{selectedCode} Balance{" "}
					</p>
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
							{balanceText}
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
					href={pageRoutes.dashboardRoutes.WALLET}
					className="bg-primary-dark w-full max-w-40"
				>
					<span>Quick Deposit</span>
					<HiOutlinePlusSmall className="scale-[1.3]" />
				</Button>
			</div>

			{/* Proactive trustline hint. A wallet must hold a trustline for the
			    circle asset before it can receive or contribute it — the #1 reason
			    a first contribution fails. Surface it up front (only once a wallet
			    is linked) instead of waiting for the on-chain error. */}
			{linkedAddress && (
				<p className="relative z-10 -mt-6 text-[11px] font-light text-white/80">
					Tip: add a {selectedCode} trustline in your wallet before your first
					contribution.
				</p>
			)}
		</div>
	);
};
