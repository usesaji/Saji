"use client";

import { useCallback } from "react";
import { useParams } from "next/navigation";
import GoBack from "@/components/dashboard/GoBack";
import { useApi } from "@/lib/hooks/useApi";
import { transactions as txApi } from "@/lib/api";
import { labelize } from "@/features/group/group-view";

const statusStyles: Record<string, string> = {
	success: "bg-success-50 text-success-700",
	pending: "bg-warning-100 text-warning-800",
	failed: "bg-error-50 text-error-500",
};

const formatAmount = (value: string | null) =>
	value === null ? "—" : `$${Number(value).toLocaleString(undefined, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`;

/** Transaction Details screen for a single transaction. */
export default function TransactionDetailPage() {
	const { id } = useParams<{ id: string }>();

	const fetcher = useCallback(() => txApi.show(Number(id)), [id]);
	const { data, loading, error, refetch } = useApi(fetcher, [id]);

	return (
		<div>
			<GoBack />

			{loading && (
				<p className="mt-6 text-center text-sm text-muted-foreground">
					Loading transaction…
				</p>
			)}

			{error && !loading && (
				<div className="mt-6 text-center text-sm">
					<p className="text-error-500">{error}</p>
					<button onClick={refetch} className="mt-2 font-medium underline">
						Try again
					</button>
				</div>
			)}

			{data && !loading && (
				<div className="mt-4 md:mt-6">
					<div className="flex items-center justify-between gap-4">
						<h2 className="text-xl md:text-3xl capitalize">
							{labelize(data.type)}
						</h2>
						<span
							className={`rounded-[33px] px-3 py-2 text-xs capitalize ${
								statusStyles[data.status] ?? statusStyles.pending
							}`}
						>
							{data.status}
						</span>
					</div>

					<div className="mt-5 bg-[#f7f7f7] rounded-2xl p-4 md:p-6">
						<h5 className="text-xs font-light md:text-sm">Amount</h5>
						<h3 className="font-medium text-3xl md:text-4xl mt-1 md:mt-2">
							{formatAmount(data.amount)}
						</h3>
					</div>

					<div className="mt-5 space-y-3 md:space-y-4">
						<Row label="Type" value={labelize(data.type)} />
						<Row label="Status" value={data.status} valueClass="capitalize" />
						<Row label="Group" value={data.group?.name ?? "—"} />
						<Row
							label="Transaction No"
							value={data.transaction_no ?? "—"}
							valueClass="break-all text-right"
						/>
						<Row
							label="Date & Time"
							value={new Date(data.date_time).toLocaleString()}
						/>
					</div>

					{data.explorer_url && (
						<a
							href={data.explorer_url}
							target="_blank"
							rel="noopener noreferrer"
							className="mt-6 inline-block font-medium text-primary underline"
						>
							Verify on Stellar explorer
						</a>
					)}
				</div>
			)}
		</div>
	);
}

function Row({
	label,
	value,
	valueClass = "",
}: {
	label: string;
	value: string;
	valueClass?: string;
}) {
	return (
		<div className="flex justify-between gap-4 border-b border-b-[#d9d9d9] pb-2">
			<span className="text-sm font-light md:text-base">{label}</span>
			<span className={`text-sm font-medium md:text-base ${valueClass}`}>
				{value}
			</span>
		</div>
	);
}
