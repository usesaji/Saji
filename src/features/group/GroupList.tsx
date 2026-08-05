"use client";

import React, { useMemo, useState } from "react";
import MyCircleCard from "./MyCircleCard";
import NoGroupPreview from "./NoGroupPreview";
import { ReusablePagination } from "../../components/dashboard/Pagination";
import { useApi } from "../../lib/hooks/useApi";
import { groups as groupsApi } from "../../lib/api";
import { groupToCircle } from "./group-view";

const ITEMS_PER_PAGE = 4;

const GroupList = () => {
	const [currentPage, setCurrentPage] = useState(1);

	// Groups the user organizes or belongs to, from the backend.
	const { data, loading, error, refetch } = useApi(() => groupsApi.index(), []);

	const circles = useMemo(
		() => (data ?? []).map(groupToCircle),
		[data],
	);

	if (loading) {
		return (
			<div className="mt-6 text-center text-sm text-muted-foreground">
				Loading your circles…
			</div>
		);
	}

	if (error) {
		return (
			<div className="mt-6 text-center text-sm">
				<p className="text-error-500">{error}</p>
				<button onClick={refetch} className="mt-2 font-medium underline">
					Try again
				</button>
			</div>
		);
	}

	if (circles.length === 0) {
		return <NoGroupPreview />;
	}

	const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
	const paginatedGroups = circles.slice(startIndex, startIndex + ITEMS_PER_PAGE);

	return (
		<div>
			<section className="mt-5 md:mt-6 grid grid-cols-1 gap-2.5 md:grid-cols-2 md:gap-4">
				{paginatedGroups.map((circle) => (
					<MyCircleCard key={circle.id} circle={circle} />
				))}
			</section>

			{circles.length > ITEMS_PER_PAGE && (
				<div className="mt-6 flex justify-center">
					<ReusablePagination
						totalItems={circles.length}
						itemsPerPage={ITEMS_PER_PAGE}
						currentPage={currentPage}
						onPageChange={setCurrentPage}
					/>
				</div>
			)}
		</div>
	);
};

export default GroupList;
