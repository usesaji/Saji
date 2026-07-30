"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { HiOutlinePlusSmall } from "react-icons/hi2";
import { PiBankLight, PiGlobeLight, PiInfoLight } from "react-icons/pi";
import GoBack from "../../components/dashboard/GoBack";
import { Button } from "../../components/ui/button";
import { pageRoutes } from "../../config/routes";
import AmountInput, { formatAmount } from "./AmountInput";
import SelectableOptionCard from "./SelectableOptionCard";
import TransactionErrorBanner from "./TransactionErrorBanner";
import TransactionSuccessScreen from "./TransactionSuccessScreen";

type Status = "idle" | "loading" | "success" | "error";

interface DestinationAccount {
	id: string;
	name: string;
	lastDigits: string;
	kind: "bank" | "stellar";
}

const WALLET_BALANCE = 12450.8;
const PROCESSING_FEE = 55;
const TAX_VAT = 100;

const initialAccounts: DestinationAccount[] = [
	{ id: "acc1", name: "Dean Ogude", lastDigits: "1393", kind: "bank" },
	{ id: "acc2", name: "Dean Ogude", lastDigits: "1393", kind: "stellar" },
];

export default function WithdrawForm() {
	const router = useRouter();

	const [amount, setAmount] = useState("");
	const [accounts, setAccounts] = useState<DestinationAccount[]>(initialAccounts);
	const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
		initialAccounts[0]?.id ?? null,
	);
	const [status, setStatus] = useState<Status>("idle");
	const [showContributionBanner, setShowContributionBanner] = useState(true);

	const numericAmount = Number(amount) || 0;
	const insufficientBalance = numericAmount > WALLET_BALANCE;
	const amountError =
		amount && insufficientBalance
			? `Insufficient balance. Your available balance is ₦${formatAmount(WALLET_BALANCE)}.`
			: null;

	const selectedAccount = accounts.find((acc) => acc.id === selectedAccountId) ?? null;
	const canContinue = numericAmount > 0 && !insufficientBalance && selectedAccount !== null;

	const handleAddAccount = () => {
		const suffix = String(Math.floor(1000 + Math.random() * 9000));
		const newAccount: DestinationAccount = {
			id: `acc-${Date.now()}`,
			name: "Dean Ogude",
			lastDigits: suffix,
			kind: accounts.length % 2 === 0 ? "bank" : "stellar",
		};
		setAccounts((prev) => [...prev, newAccount]);
		setSelectedAccountId(newAccount.id);
	};

	const handleRemoveAccount = (id: string) => {
		setAccounts((prev) => prev.filter((acc) => acc.id !== id));
		setSelectedAccountId((current) => (current === id ? null : current));
	};

	const handleConfirm = () => {
		if (!canContinue) return;
		setStatus("loading");

		setTimeout(() => {
			const succeeded = Math.random() < 0.7;
			setStatus(succeeded ? "success" : "error");
		}, 1500);
	};

	const handleBackToWallet = () => {
		router.push(pageRoutes.dashboardRoutes.WALLET);
	};

	if (status === "success") {
		return (
			<TransactionSuccessScreen
				heading="Withdrawal Successful"
				description={`₦${formatAmount(numericAmount)} is on its way to ${selectedAccount?.name}'s account ending with ${selectedAccount?.lastDigits}.`}
				amount={`₦${formatAmount(numericAmount)}`}
				buttonLabel="Back to Wallet"
				onButtonClick={handleBackToWallet}
			/>
		);
	}

	const isLoading = status === "loading";

	return (
		<div className="mx-auto md:max-w-xl lg:max-w-2xl w-full px-0 sm:px-4 py-2">
			<div className="space-y-6">
				<GoBack />

				<h2 className="text-xl font-semibold text-neutral-dark">Withdraw</h2>

				<AmountInput
					label="How much would you like to withdraw?"
					value={amount}
					onChange={setAmount}
					maxAmount={WALLET_BALANCE}
					error={amountError}
					disabled={isLoading}
				/>

				<div>
					<div className="flex items-center justify-between mb-2.5">
						<p className="text-xs font-light text-neutral-light-active">
							Destination Account
						</p>
						<button
							type="button"
							onClick={handleAddAccount}
							disabled={isLoading}
							className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary-hover cursor-pointer bg-transparent border-0 disabled:cursor-not-allowed disabled:opacity-50"
						>
							<HiOutlinePlusSmall className="text-base" />
							Add New
						</button>
					</div>

					{accounts.length > 0 ? (
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
							{accounts.map((account) => (
								<SelectableOptionCard
									key={account.id}
									icon={
										account.kind === "bank" ? (
											<PiBankLight className="text-lg" />
										) : (
											<PiGlobeLight className="text-lg" />
										)
									}
									iconBg={account.kind === "bank" ? "bg-primary-light" : "bg-secondary-light"}
									label={account.name}
									sublabel={`Account ending with ${account.lastDigits}`}
									selected={selectedAccountId === account.id}
									onClick={() => setSelectedAccountId(account.id)}
									onRemove={() => handleRemoveAccount(account.id)}
									disabled={isLoading}
								/>
							))}
						</div>
					) : (
						<div className="flex flex-col items-center justify-center gap-2 py-10 rounded-[15px] border border-dashed border-neutral-light-hover">
							<PiInfoLight className="text-2xl text-neutral-light-active" />
							<p className="text-xs font-light text-neutral-light-active">
								No Accounts Added
							</p>
						</div>
					)}
				</div>

				{status === "error" && (
					<TransactionErrorBanner
						title="Withdrawal Failed"
						message="We couldn't process your withdrawal. Please check your connection and try again."
						onDismiss={() => setStatus("idle")}
					/>
				)}

				{status !== "error" && canContinue && (
					<div className="divide-y divide-neutral-light">
						<div className="flex justify-between py-2.5 text-sm">
							<span className="font-light text-neutral-light-active">Processing Fee</span>
							<span className="font-medium text-neutral-dark">
								₦{formatAmount(PROCESSING_FEE)}
							</span>
						</div>
						<div className="flex justify-between py-2.5 text-sm">
							<span className="font-light text-neutral-light-active">Taxes (VAT)</span>
							<span className="font-medium text-neutral-dark">
								₦{formatAmount(TAX_VAT)}
							</span>
						</div>
					</div>
				)}

				<Button
					type="button"
					onClick={handleConfirm}
					disabled={!canContinue}
					isLoading={isLoading}
					className="w-full "
				>
					Confirm Withdrawal
				</Button>

				{showContributionBanner && (
					<div className="bg-primary-light rounded-[20px] p-5 relative">
						<button
							type="button"
							onClick={() => setShowContributionBanner(false)}
							className="absolute top-3 right-3 text-primary hover:text-primary-hover cursor-pointer bg-transparent border-0"
						>
							<HiOutlinePlusSmall className="text-lg rotate-45" />
						</button>
						<h4 className="text-sm font-semibold text-primary-darker pr-6">
							Upcoming Contribution
						</h4>
						<p className="text-xs font-light text-primary-dark mt-1.5 leading-relaxed pr-6">
							Your monthly group contribution of $450.00 is due in 3 days. Ensure
							you leave enough balance to avoid missed payment penalties.
						</p>
					</div>
				)}
			</div>
		</div>
	);
}
