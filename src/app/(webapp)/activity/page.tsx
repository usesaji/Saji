"use client";
import React, { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Transaction } from "../../../features/activity/ActivityCard";
import ActivityList from "../../../features/activity/ActivityList";
import TransactionDetails from "../../../features/activity/TransactionDetails";
import { mockTransactions } from "../../../lib/utils/mock-transactions";

function ActivityPageContent() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const requestedTxId = searchParams.get("tx");

	const [selectedTx, setSelectedTx] = useState<Transaction | null>(
		() => mockTransactions.find((tx) => tx.id === requestedTxId) ?? null,
	);

	const handleBackFromDetails = () => {
		setSelectedTx(null);
		if (requestedTxId) {
			router.replace("/activity");
		}
	};

	return (
		<div className="max-w-md mx-auto sm:max-w-lg md:max-w-xl lg:max-w-2xl w-full px-0 sm:px-4 py-2 transition-all duration-300">
			{selectedTx ? (
				<TransactionDetails tx={selectedTx} onBack={handleBackFromDetails} />
			) : (
				<div className="space-y-6">
					<h2 className="text-xl font-semibold text-neutral-dark">Recent Activity</h2>
					<ActivityList transactions={mockTransactions} onViewDetails={setSelectedTx} />
				</div>
			)}
		</div>
	);
}

export default function Page() {
	return (
		<Suspense fallback={null}>
			<ActivityPageContent />
		</Suspense>
	);
}
