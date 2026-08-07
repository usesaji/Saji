"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import GoBack from "../../components/dashboard/GoBack";
import { Button } from "../../components/ui/button";
import { pageRoutes } from "../../config/routes";
import { CircleGroup } from "../../lib/utils/mock-data";
import AmountInput, { formatAmount } from "../wallet/AmountInput";
import TransactionErrorBanner from "../wallet/TransactionErrorBanner";
import TransactionSuccessScreen from "../wallet/TransactionSuccessScreen";

type Status = "idle" | "loading" | "success" | "error";

interface ContributeFormProps {
	group: CircleGroup;
}

export default function ContributeForm({ group }: ContributeFormProps) {
	const router = useRouter();

	const [amount, setAmount] = useState(String(group.contributionAmount || ""));
	const [status, setStatus] = useState<Status>("idle");

	const numericAmount = Number(amount) || 0;
	const canContinue = numericAmount > 0;
	const isLoading = status === "loading";

	const maxAmount = Math.max(group.target - group.current, group.contributionAmount, 15000);

	const handleContinue = () => {
		if (!canContinue) return;
		setStatus("loading");

		setTimeout(() => {
			const succeeded = Math.random() < 0.7;
			setStatus(succeeded ? "success" : "error");
		}, 1500);
	};

	const handleBackToGroup = () => {
		router.push(pageRoutes.dashboardRoutes.GROUP(group.id));
	};

	if (status === "success") {
		return (
			<TransactionSuccessScreen
				heading="Contribution Successful"
				description={`Your contribution of ₦${formatAmount(numericAmount)} to ${group.title} has been received.`}
				amount={`₦${formatAmount(numericAmount)}`}
				buttonLabel="Back to Group"
				onButtonClick={handleBackToGroup}
			/>
		);
	}

	return (
		<div className="mx-auto md:max-w-xl lg:max-w-2xl w-full px-0 sm:px-4 py-2">
			<div className="space-y-6">
				<GoBack />

				<h2 className="text-xl font-semibold text-neutral-dark">
					{group.title} Contribution
				</h2>

				<AmountInput
					label="How much would you like to contribute?"
					value={amount}
					onChange={setAmount}
					maxAmount={maxAmount}
					disabled={isLoading}
				/>

				{status === "error" && (
					<TransactionErrorBanner
						title="Contribution Failed"
						message="We couldn't process your contribution. Please check your connection and try again."
						onDismiss={() => setStatus("idle")}
					/>
				)}

				<Button
					type="button"
					onClick={handleContinue}
					disabled={!canContinue}
					isLoading={isLoading}
					className="w-full bg-neutral-dark text-white font-semibold rounded-full h-12 border-0 cursor-pointer shadow-none hover:bg-neutral-hover"
				>
					Continue
				</Button>
			</div>
		</div>
	);
}
