"use client";

import { useCallback, useState } from "react";
import ActivityCard from "../../../features/activity/ActivityCard";
import { ReusablePagination } from "../../../components/dashboard/Pagination";
import { useApi } from "../../../lib/hooks/useApi";
import { activity as activityApi } from "../../../lib/api";

const PER_PAGE = 10;

export default function Page() {
	const [page, setPage] = useState(1);

	const fetcher = useCallback(
		() => activityApi.index({ per_page: PER_PAGE, filter: "all", page }),
		[page],
	);
	const { data, loading, error, refetch } = useApi(fetcher, [page]);

	const rows = data?.data ?? [];

	return (
		<div>
			<h2 className="text-xl font-light md:text-3xl md:font-normal">Activity</h2>

			{loading && (
				<p className="mt-6 text-sm text-muted-foreground">Loading activity…</p>
			)}

			{error && !loading && (
				<div className="mt-6 text-sm">
					<p className="text-error-500">{error}</p>
					<button onClick={refetch} className="mt-2 font-medium underline">
						Try again
					</button>
				</div>
			)}

			{!loading && !error && rows.length === 0 && (
				<p className="mt-6 text-sm text-muted-foreground">No activity yet.</p>
			)}

			{rows.length > 0 && (
				<>
					<div className="mt-5 max-md:space-y-2 md:grid md:grid-cols-2 md:gap-3.75">
						{rows.map((row) => (
							<ActivityCard key={row.id} activity={row} />
						))}
					</div>

					{data && data.total > PER_PAGE && (
						<div className="mt-6 flex justify-center">
							<ReusablePagination
								totalItems={data.total}
								itemsPerPage={PER_PAGE}
								currentPage={page}
								onPageChange={setPage}
							/>
						</div>
					)}
				</>
			)}
		</div>
	);
}
