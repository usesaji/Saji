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

const BANKS = [
	"Union Bank",
	"First Bank",
	"Access Bank",
	"Ecobank",
	"GTBank",
	"Zenith Bank",
	"UBA",
	"Providus Bank",
];

// Demo-only: pretends to resolve an account number to a name via a bank API.
const MOCK_ACCOUNT_NAME = "DEAN UNAMOMA OGUDE";

export default function BankInfoView() {
	const router = useRouter();
	const addBankAccount = useWithdrawalAccountsStore((state) => state.addBankAccount);

	const [bank, setBank] = useState<string | null>(null);
	const [bankSearch, setBankSearch] = useState("");
	const [accountNumber, setAccountNumber] = useState("");
	const [resolvedName, setResolvedName] = useState<string | null>(null);
	const [isResolving, setIsResolving] = useState(false);
	const [isSaving, setIsSaving] = useState(false);

	const filteredBanks = BANKS.filter((name) =>
		name.toLowerCase().includes(bankSearch.trim().toLowerCase()),
	);

	const handleAccountNumberChange = (raw: string) => {
		const digits = raw.replace(/\D/g, "").slice(0, 10);
		setAccountNumber(digits);
		setResolvedName(null);

		if (digits.length === 10 && bank) {
			setIsResolving(true);
			setTimeout(() => {
				setIsResolving(false);
				setResolvedName(MOCK_ACCOUNT_NAME);
			}, 700);
		}
	};

	const canConfirm = bank !== null && accountNumber.length === 10 && resolvedName !== null;

	const handleConfirm = () => {
		if (!canConfirm || !bank || !resolvedName) return;
		setIsSaving(true);

		setTimeout(() => {
			setIsSaving(false);
			addBankAccount({ bankName: bank, accountNumber, accountName: resolvedName });
			toast.success("Your bank account has been added", "Account Info Updated");
			router.push(pageRoutes.dashboardRoutes.PROFILE_WITHDRAWAL_SAVED_ACCOUNTS);
		}, 1000);
	};

	return (
		<div className="mx-auto md:max-w-xl lg:max-w-2xl w-full px-0 sm:px-4 py-2">
			<div className="space-y-6">
				<GoBack />

				<h2 className="text-xl font-semibold text-neutral-dark">Bank Info</h2>

				<div className="space-y-2">
					<p className="text-sm font-light text-neutral-dark">Select Bank</p>
					<Select
						value={bank}
						onValueChange={(value) => {
							setBank(value);
							setResolvedName(null);
							if (accountNumber.length === 10) {
								setIsResolving(true);
								setTimeout(() => {
									setIsResolving(false);
									setResolvedName(MOCK_ACCOUNT_NAME);
								}, 700);
							}
						}}
					>
						<SelectTrigger className="w-full h-10.75 md:h-12 rounded-[900px] border-neutral-light-hover px-6 justify-between">
							<SelectValue placeholder="Choose your bank" />
						</SelectTrigger>
						<SelectContent className="w-full min-w-70 p-0 bg-white">
							<div className="p-2 border-b border-neutral-light">
								<input
									type="text"
									value={bankSearch}
									onChange={(e) => setBankSearch(e.target.value)}
									placeholder="Search for Banks"
									className="w-full h-9 rounded-lg bg-neutral-comment px-3 text-sm outline-none"
								/>
							</div>
							<SelectGroup>
								{filteredBanks.map((name) => (
									<SelectItem key={name} value={name}>
										{name}
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
				</div>

				<div>
					<InputField
						name="accountNumber"
						label="Account Number"
						type="text"
						placeholder="0123456789"
						value={accountNumber}
						onChange={(e) => handleAccountNumberChange(e.target.value)}
					/>
					{isResolving && (
						<p className="text-xs font-light text-neutral-light-active mt-1.5 ml-1">
							Resolving account name...
						</p>
					)}
					{resolvedName && !isResolving && (
						<p className="text-sm font-semibold text-neutral-dark mt-1.5 ml-1">
							{resolvedName}
						</p>
					)}
				</div>

				<SecurityInfoBanner />

				<Button
					type="button"
					onClick={handleConfirm}
					disabled={!canConfirm}
					isLoading={isSaving}
					className="w-full"
				>
					Confirm Bank Account
				</Button>
			</div>
		</div>
	);
}
