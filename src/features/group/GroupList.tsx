"use client";

import React, { useMemo, useState } from "react";
import MyCircleCard from "./MyCircleCard";
import { circleGroups, CircleGroup } from "../../lib/utils/mock-data";
import { ReusablePagination } from "../../components/dashboard/Pagination";
import { getEffectiveMembership, useGroupMembershipStore } from "../../lib/store/group-membership-store";

const ITEMS_PER_PAGE = 4;

type OwnershipFilter = "mine" | "public";
type StatusFilter = "all" | CircleGroup["status"];

const ownershipFilters: { value: OwnershipFilter; label: string }[] = [
	{ value: "mine", label: "My Groups" },
	{ value: "public", label: "Public Groups" },
];

const statusFilters: { value: StatusFilter; label: string }[] = [
	{ value: "all", label: "All" },
	{ value: "PAID", label: "Paid" },
	{ value: "PENDING", label: "Pending" },
	{ value: "OVERDUE", label: "Overdue" },
];

const GroupList = () => {
	const joinedGroupIds = useGroupMembershipStore((state) => state.joinedGroupIds);
	const [ownershipFilter, setOwnershipFilter] = useState<OwnershipFilter>("mine");
	const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
	const [currentPage, setCurrentPage] = useState(1);

	// Groups you've created or joined.
	const myGroups = useMemo(
		() =>
			circleGroups.filter(
				(circle) => getEffectiveMembership(circle, joinedGroupIds) !== "none",
			),
		[joinedGroupIds],
	);

	// Public groups you haven't joined yet — browsable to preview & join.
	const publicGroups = useMemo(
		() =>
			circleGroups.filter(
				(circle) =>
					circle.visibility === "public" &&
					getEffectiveMembership(circle, joinedGroupIds) === "none",
			),
		[joinedGroupIds],
	);

	const filteredGroups = useMemo(() => {
		if (ownershipFilter === "public") return publicGroups;
		if (statusFilter === "all") return myGroups;
		return myGroups.filter((circle) => circle.status === statusFilter);
	}, [ownershipFilter, publicGroups, myGroups, statusFilter]);

	const handleOwnershipFilterChange = (filter: OwnershipFilter) => {
		setOwnershipFilter(filter);
		setCurrentPage(1);
	};

	const handleStatusFilterChange = (filter: StatusFilter) => {
		setStatusFilter(filter);
		setCurrentPage(1);
	};

	const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
	const paginatedGroups = filteredGroups.slice(
		startIndex,
		startIndex + ITEMS_PER_PAGE,
	);

	return (
		<div>
			<div className="flex items-center gap-2 mt-5 md:mt-6 overflow-x-auto hide-scroll">
				{ownershipFilters.map((filter) => {
					const active = ownershipFilter === filter.value;
					return (
						<button
							key={filter.value}
							type="button"
							onClick={() => handleOwnershipFilterChange(filter.value)}
							className={`whitespace-nowrap rounded-full px-5 py-2 text-xs font-semibold cursor-pointer border-0 transition-colors ${
								active
									? "bg-neutral-dark text-white"
									: "bg-neutral-comment text-neutral-light-active hover:bg-neutral-light-hover"
							}`}
						>
							{filter.label}
						</button>
					);
				})}
			</div>

			{ownershipFilter === "mine" && (
				<div className="flex items-center gap-2 mt-3 overflow-x-auto hide-scroll">
					{statusFilters.map((filter) => {
						const active = statusFilter === filter.value;
						return (
							<button
								key={filter.value}
								type="button"
								onClick={() => handleStatusFilterChange(filter.value)}
								className={`whitespace-nowrap rounded-full px-5 py-2 text-xs font-semibold cursor-pointer border-0 transition-colors ${
									active
										? "bg-primary text-white"
										: "bg-neutral-comment text-neutral-light-active hover:bg-neutral-light-hover"
								}`}
							>
								{filter.label}
							</button>
						);
					})}
				</div>
			)}

			{paginatedGroups.length > 0 ? (
				<section className="mt-5 md:mt-6 grid grid-cols-1 gap-2.5 md:grid-cols-2 md:gap-4">
					{paginatedGroups.map((circle) => (
						<MyCircleCard key={circle.id} circle={circle} />
					))}
				</section>
			) : (
				<p className="text-xs font-light text-neutral-light-active text-center py-10 italic">
					{ownershipFilter === "public"
						? "No public groups to join right now."
						: "No groups match this filter."}
				</p>
			)}

			{filteredGroups.length > ITEMS_PER_PAGE && (
				<div className="mt-6 flex justify-center">
					<ReusablePagination
						totalItems={filteredGroups.length}
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
