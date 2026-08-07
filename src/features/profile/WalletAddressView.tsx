"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import GoBack from "../../components/dashboard/GoBack";
import { Button } from "../../components/ui/button";
import InputField from "../../components/ui/custom/InputField";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "../../components/ui/select";
import { pageRoutes } from "../../config/routes";
import { useWithdrawalAccountsStore } from "../../lib/store/withdrawal-accounts-store";
import { toast } from "../../lib/utils/toast";
import SecurityInfoBanner from "./SecurityInfoBanner";

const NETWORKS = ["Bitcoin (BTC)", "USDC", "USDT", "Stellar (XLM)", "Ethereum (ETH)"];

export default function WalletAddressView() {
	const router = useRouter();
	const addWallet = useWithdrawalAccountsStore((state) => state.addWallet);

	const [network, setNetwork] = useState<string | null>(null);
	const [networkSearch, setNetworkSearch] = useState("");
	const [address, setAddress] = useState("");
	const [isSaving, setIsSaving] = useState(false);

	const filteredNetworks = NETWORKS.filter((name) =>
		name.toLowerCase().includes(networkSearch.trim().toLowerCase()),
	);

	const canSave = network !== null && address.trim().length >= 8;

	const handleSave = () => {
		if (!canSave || !network) return;
		setIsSaving(true);

		setTimeout(() => {
			setIsSaving(false);
			addWallet({ network, address: address.trim(), accountName: "Dean Ogude" });
			toast.success("Your wallet address has been added", "Wallet Address Updated");
			router.push(pageRoutes.dashboardRoutes.PROFILE_WITHDRAWAL_SAVED_ACCOUNTS);
		}, 1000);
	};

	return (
		<div className="mx-auto md:max-w-xl lg:max-w-2xl w-full px-0 sm:px-4 py-2">
			<div className="space-y-6">
				<GoBack />

				<h2 className="text-xl font-semibold text-neutral-dark">Wallet Address</h2>

				<div className="space-y-2">
					<p className="text-sm font-light text-neutral-dark">Select Network</p>
					<Select value={network} onValueChange={setNetwork}>
						<SelectTrigger className="w-full h-10.75 md:h-12 rounded-[900px] border-neutral-light-hover px-6 justify-between">
							<SelectValue placeholder="Choose Network" />
						</SelectTrigger>
						<SelectContent className="w-full min-w-70 p-0">
							<div className="p-2 border-b border-neutral-light">
								<input
									type="text"
									value={networkSearch}
									onChange={(e) => setNetworkSearch(e.target.value)}
									placeholder="Search for Networks"
									className="w-full h-9 rounded-lg bg-neutral-comment px-3 text-sm outline-none"
								/>
							</div>
							<SelectGroup>
								{filteredNetworks.map((name) => (
									<SelectItem key={name} value={name}>
										{name}
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
				</div>

				<InputField
					name="walletAddress"
					label="Wallet Address"
					type="text"
					placeholder="GB5QZ3K7L2XJY8N6R4WFM9PTCVHD..."
					value={address}
					onChange={(e) => setAddress(e.target.value)}
				/>

				<SecurityInfoBanner />

				<Button
					type="button"
					onClick={handleSave}
					disabled={!canSave}
					isLoading={isSaving}
					className="w-full"
				>
					Save &amp; Continue
				</Button>
			</div>
		</div>
	);
}
