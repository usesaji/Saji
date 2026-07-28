"use client";

import React, { useState } from "react";
import MyCircleCard from "./MyCircleCard";
import { circleGroups } from "../../lib/utils/mock-data";
import { ReusablePagination } from "../../components/dashboard/Pagination";

const ITEMS_PER_PAGE = 4;

const GroupList = () => {
	const [currentPage, setCurrentPage] = useState(1);

	const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
	const paginatedGroups = circleGroups.slice(
		startIndex,
		startIndex + ITEMS_PER_PAGE,
	);

	return (
		<div>
			<section className="mt-5 md:mt-6 grid grid-cols-1 gap-2.5 md:grid-cols-2 md:gap-4">
				{paginatedGroups.map((circle) => (
					<MyCircleCard key={circle.id} circle={circle} />
				))}
			</section>

			<div className="mt-6 flex justify-center">
				<ReusablePagination
					totalItems={circleGroups.length}
					itemsPerPage={ITEMS_PER_PAGE}
					currentPage={currentPage}
					onPageChange={setCurrentPage}
				/>
			</div>
		</div>
	);
};

export default GroupList;
