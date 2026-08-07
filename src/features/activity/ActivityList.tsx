"use client";
import React, { useMemo, useState } from "react";
import ActivityCard, { Transaction } from "./ActivityCard";
import { ReusablePagination } from "../../components/dashboard/Pagination";

type FilterType = "all" | "contribution" | "payout" | "withdrawal";

const ITEMS_PER_PAGE = 4;

interface ActivityListProps {
	transactions: Transaction[];
	onViewDetails: (tx: Transaction) => void;
}

export default function ActivityList({ transactions, onViewDetails }: ActivityListProps) {
	const [activeFilter, setActiveFilter] = useState<FilterType>("all");
	const [currentPage, setCurrentPage] = useState(1);

	const filteredTransactions = useMemo(() => {
		if (activeFilter === "all") return transactions;
		return transactions.filter((tx) => tx.type === activeFilter);
	}, [transactions, activeFilter]);

	const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
	const paginatedTransactions = filteredTransactions.slice(
		startIndex,
		startIndex + ITEMS_PER_PAGE,
	);

	const groupedTransactions = useMemo(() => {
		const today: Transaction[] = [];
		const yesterday: Transaction[] = [];

		paginatedTransactions.forEach((tx) => {
			if (tx.date.includes("July 1st")) {
				today.push(tx);
			} else {
				yesterday.push(tx);
			}
		});

		return { today, yesterday };
	}, [paginatedTransactions]);

	const handleFilterChange = (filter: FilterType) => {
		setActiveFilter(filter);
		setCurrentPage(1);
	};

	return (
		<>
			{/* Filters Tabs */}
			<div className="flex items-center gap-2 overflow-x-auto pb-2 hide-scroll shrink-0">
				{(["all", "contribution", "payout", "withdrawal"] as const).map((filter) => {
					const active = activeFilter === filter;
					const label = filter.charAt(0).toUpperCase() + filter.slice(1) + "s";
					return (
						<button
							key={filter}
							type="button"
							onClick={() => handleFilterChange(filter)}
							className={`whitespace-nowrap rounded-full px-5 py-2 text-xs font-semibold cursor-pointer border-0 transition-colors ${
								active
									? "bg-primary text-white"
									: "bg-neutral-comment text-neutral-light-active hover:bg-neutral-light-hover"
							}`}
						>
							{filter === "all" ? "All" : label}
						</button>
					);
				})}
			</div>

			{/* Transactions List */}
			<div className="space-y-6 mt-4">
				{groupedTransactions.today.length > 0 && (
					<div className="space-y-3.5">
						<h4 className="text-xs font-light text-neutral-light-active px-1">Today</h4>
						<div className="space-y-3.5">
							{groupedTransactions.today.map((tx) => (
								<ActivityCard key={tx.id} tx={tx} onViewDetails={onViewDetails} />
							))}
						</div>
					</div>
				)}

				{groupedTransactions.yesterday.length > 0 && (
					<div className="space-y-3.5 pt-2">
						<h4 className="text-xs font-light text-neutral-light-active px-1">Yesterday</h4>
						<div className="space-y-3.5">
							{groupedTransactions.yesterday.map((tx) => (
								<ActivityCard key={tx.id} tx={tx} onViewDetails={onViewDetails} />
							))}
						</div>
					</div>
				)}

				{filteredTransactions.length === 0 && (
					<p className="text-xs font-light text-neutral-light-active text-center py-10 italic">
						No recent transactions found.
					</p>
				)}
			</div>

			{/* Pagination */}
			{filteredTransactions.length > ITEMS_PER_PAGE && (
				<div className="mt-6 flex justify-center">
					<ReusablePagination
						totalItems={filteredTransactions.length}
						itemsPerPage={ITEMS_PER_PAGE}
						currentPage={currentPage}
						onPageChange={setCurrentPage}
					/>
				</div>
			)}
		</>
	);
}
