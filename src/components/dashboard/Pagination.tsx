"use client";

import React from "react";
import {
	Pagination,
	PaginationContent,
	PaginationEllipsis,
	PaginationItem,
	PaginationLink,
	PaginationNext,
	PaginationPrevious,
} from "@/components/ui/pagination";
import { usePagination } from "../../lib/hooks/usePagination";

interface ReusablePaginationProps {
	totalItems: number;
	itemsPerPage: number;
	currentPage: number;
	onPageChange: (page: number) => void;
	siblingCount?: number;
	className?: string;
}

export function ReusablePagination({
	totalItems,
	itemsPerPage,
	currentPage,
	onPageChange,
	siblingCount = 1,
	className,
}: ReusablePaginationProps) {
	const { paginationRange, totalPages, DOTS } = usePagination({
		totalItems,
		itemsPerPage,
		currentPage,
		siblingCount,
	});

	// Nothing to paginate (0 or 1 page)
	if (totalPages <= 1) return null;

	function handleClick(page: number) {
		if (page < 1 || page > totalPages || page === currentPage) return;
		onPageChange(page);
	}

	return (
		<Pagination className={className}>
			<PaginationContent>
				<PaginationItem>
					<PaginationPrevious
						disabled={currentPage === 1}
						className={
							currentPage === 1 ? "pointer-events-none opacity-40" : ""
						}
						onClick={() => handleClick(currentPage - 1)}
					/>
				</PaginationItem>

				{paginationRange.map((page, i) => {
					if (page === DOTS) {
						return (
							<PaginationItem key={`dots-${i}`}>
								<PaginationEllipsis />
							</PaginationItem>
						);
					}

					const isActive = page === currentPage;

					return (
						<PaginationItem key={page}>
							<PaginationLink
								isActive={isActive}
								onClick={() => handleClick(page as number)}
							>
								{page}
							</PaginationLink>
						</PaginationItem>
					);
				})}

				<PaginationItem>
					<PaginationNext
						disabled={currentPage === totalPages}
						className={
							currentPage === totalPages ? "pointer-events-none opacity-40" : ""
						}
						onClick={() => handleClick(currentPage + 1)}
					/>
				</PaginationItem>
			</PaginationContent>
		</Pagination>
	);
}
