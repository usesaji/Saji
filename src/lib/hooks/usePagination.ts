import { useMemo } from "react";

const DOTS = "...";

interface UsePaginationProps {
	totalItems: number;
	itemsPerPage: number;
	currentPage: number;
	siblingCount?: number; // pages shown on each side of current page
}

/**
 * Returns an array of page numbers and DOTS placeholders to render,
 * e.g. [1, "...", 4, 5, 6, "...", 10]
 */
export function usePagination({
	totalItems,
	itemsPerPage,
	currentPage,
	siblingCount = 1,
}: UsePaginationProps) {
	const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));

	const paginationRange = useMemo(() => {
		const totalPageNumbers = siblingCount * 2 + 5; // first + last + current + 2*siblings + 2*dots

		if (totalPageNumbers >= totalPages) {
			return range(1, totalPages);
		}

		const leftSiblingIndex = Math.max(currentPage - siblingCount, 1);
		const rightSiblingIndex = Math.min(currentPage + siblingCount, totalPages);

		const showLeftDots = leftSiblingIndex > 2;
		const showRightDots = rightSiblingIndex < totalPages - 1;

		const firstPageIndex = 1;
		const lastPageIndex = totalPages;

		if (!showLeftDots && showRightDots) {
			const leftItemCount = 3 + 2 * siblingCount;
			const leftRange = range(1, leftItemCount);
			return [...leftRange, DOTS, totalPages];
		}

		if (showLeftDots && !showRightDots) {
			const rightItemCount = 3 + 2 * siblingCount;
			const rightRange = range(totalPages - rightItemCount + 1, totalPages);
			return [firstPageIndex, DOTS, ...rightRange];
		}

		if (showLeftDots && showRightDots) {
			const middleRange = range(leftSiblingIndex, rightSiblingIndex);
			return [firstPageIndex, DOTS, ...middleRange, DOTS, lastPageIndex];
		}

		return range(1, totalPages);
	}, [totalPages, currentPage, siblingCount]);

	return { paginationRange, totalPages, DOTS };
}

function range(start: number, end: number) {
	const length = end - start + 1;
	return Array.from({ length }, (_, i) => start + i);
}
