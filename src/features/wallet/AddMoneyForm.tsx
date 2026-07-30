"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { HiOutlineBuildingLibrary } from "react-icons/hi2";
import { PiGlobeLight, PiMoneyWavyLight } from "react-icons/pi";
import { FiCheck, FiCopy } from "react-icons/fi";
import GoBack from "../../components/dashboard/GoBack";
import { Button } from "../../components/ui/button";
import { pageRoutes } from "../../config/routes";
import AmountInput, { formatAmount } from "./AmountInput";
import SelectableOptionCard from "./SelectableOptionCard";
import TransactionErrorBanner from "./TransactionErrorBanner";
import TransactionSuccessScreen from "./TransactionSuccessScreen";

type PaymentMethod = "bank" | "stellar";
type Status = "idle" | "loading" | "success" | "error";

const STELLAR_ADDRESS = "GB5QZ3K7L2XJY8N6R4WFM9PTCVHDAEUSIKGNQY7B3LZXM5RJ2TC8VQNP";

const bankDetails = {
	bankName: "Providus Bank",
	accountNumber: "816 551 6581",
	accountName: "SAJI-MEM_99321",
};

export default function AddMoneyForm() {
	const router = useRouter();

	const [amount, setAmount] = useState("");
	const [method, setMethod] = useState<PaymentMethod | null>(null);
	const [status, setStatus] = useState<Status>("idle");
	const [copiedField, setCopiedField] = useState<string | null>(null);

	const numericAmount = Number(amount) || 0;
	const canContinue = numericAmount > 0 && method !== null;

	const handleCopy = (field: string, text: string) => {
		navigator.clipboard.writeText(text);
		setCopiedField(field);
		setTimeout(() => setCopiedField((current) => (current === field ? null : current)), 2000);
	};

	const handleContinue = () => {
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
				heading="Money Added Successfully"
				description={`Your deposit of ₦${formatAmount(numericAmount)} via ${
					method === "bank" ? "Bank Transfer" : "Stellar Network"
				} has been received and credited to your wallet.`}
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

				<h2 className="text-xl font-semibold text-neutral-dark">Add Money</h2>

				<AmountInput
					label="Enter amount"
					value={amount}
					onChange={setAmount}
					maxAmount={500000}
					disabled={isLoading}
				/>

				<div>
					<p className="text-xs font-light text-neutral-light-active mb-2.5">
						Select Payment Method
					</p>
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
						<SelectableOptionCard
							icon={<HiOutlineBuildingLibrary className="text-lg" />}
							label="Bank Transfer"
							sublabel="Usually takes 1-5 Minutes"
							selected={method === "bank"}
							onClick={() => setMethod("bank")}
							disabled={isLoading}
						/>
						<SelectableOptionCard
							icon={<PiGlobeLight className="text-lg" />}
							label="Stellar Network"
							sublabel="Most Used (Reliable)"
							selected={method === "stellar"}
							onClick={() => setMethod("stellar")}
							disabled={isLoading}
						/>
					</div>
				</div>

				{status === "error" && (
					<TransactionErrorBanner
						title={method === "bank" ? "Network Downtime" : "Transaction Failed"}
						message={
							method === "bank"
								? "Bank Transfers are currently unavailable due to high volume of transfers, try again shortly."
								: "We couldn't process your deposit. Please check your connection and try again."
						}
						onDismiss={() => setStatus("idle")}
					/>
				)}

				{status !== "error" && method === "stellar" && (
					<div className="bg-neutral-comment rounded-[20px] p-5 flex items-center justify-between gap-4 overflow-hidden">
						<div className="min-w-0">
							<div className="flex items-center gap-2">
								<h4 className="text-sm font-semibold text-neutral-dark">
									Stellar Blockchain
								</h4>
								<span className="text-[10px] font-medium bg-primary-light text-primary rounded-full px-2 py-0.5">
									Testnet
								</span>
							</div>
							<div className="flex items-start gap-1.5 mt-2.5">
								<p className="text-xs font-light text-neutral-dark break-all leading-relaxed">
									{STELLAR_ADDRESS}
								</p>
								<button
									type="button"
									onClick={() => handleCopy("stellar", STELLAR_ADDRESS)}
									className="text-primary hover:text-primary-hover shrink-0 cursor-pointer bg-transparent border-0 mt-0.5"
								>
									{copiedField === "stellar" ? (
										<FiCheck className="text-success-600 text-xs" />
									) : (
										<FiCopy className="text-xs" />
									)}
								</button>
							</div>
						</div>
						<PiMoneyWavyLight className="text-primary text-5xl md:text-6xl shrink-0 max-[380px]:hidden" />
					</div>
				)}

				{status !== "error" && method === "bank" && (
					<div className="bg-neutral-comment rounded-[20px] p-5 space-y-3.5">
						<h4 className="text-xs font-light text-neutral-light-active border-b border-neutral-light pb-2.5">
							Account Details
						</h4>

						{(
							[
								["bankName", "Bank Name", bankDetails.bankName],
								["accountNumber", "Account Number", bankDetails.accountNumber],
								["accountName", "Account Name", bankDetails.accountName],
							] as const
						).map(([key, fieldLabel, value]) => (
							<div key={key} className="flex items-center justify-between gap-3">
								<div className="min-w-0">
									<p className="text-[10px] font-light text-neutral-light-active">
										{fieldLabel}
									</p>
									<p className="text-sm font-medium text-neutral-dark truncate">
										{value}
									</p>
								</div>
								<button
									type="button"
									onClick={() => handleCopy(key, value)}
									className="text-primary hover:text-primary-hover shrink-0 cursor-pointer bg-transparent border-0"
								>
									{copiedField === key ? (
										<FiCheck className="text-success-600 text-sm" />
									) : (
										<FiCopy className="text-sm" />
									)}
								</button>
							</div>
						))}
					</div>
				)}

				<Button
					type="button"
					onClick={handleContinue}
					disabled={!canContinue}
					isLoading={isLoading}
					className="w-full cursor-pointer"
				>
					Continue
				</Button>
			</div>
		</div>
	);
}
