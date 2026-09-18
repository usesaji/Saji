import * as React from "react";
import {
	ChevronLeftIcon,
	ChevronRightIcon,
	MoreHorizontalIcon,
} from "lucide-react";
import { cn } from "../../lib/utils";

function Pagination({ className, ...props }: React.ComponentProps<"nav">) {
	return (
		<nav
			role="navigation"
			aria-label="pagination"
			data-slot="pagination"
			className={cn("mx-auto flex w-full justify-center", className)}
			{...props}
		/>
	);
}

function PaginationContent({
	className,
	...props
}: React.ComponentProps<"ul">) {
	return (
		<ul
			data-slot="pagination-content"
			className={cn("flex items-center gap-1", className)}
			{...props}
		/>
	);
}

function PaginationItem({ ...props }: React.ComponentProps<"li">) {
	return <li data-slot="pagination-item" {...props} />;
}

interface PaginationLinkProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	isActive?: boolean;
}

function PaginationLink({
	className,
	isActive,
	children,
	...props
}: PaginationLinkProps) {
	return (
		<button
			type="button"
			data-slot="pagination-link"
			data-active={isActive}
			aria-current={isActive ? "page" : undefined}
			className={cn(
				"flex size-9 items-center justify-center rounded-full text-sm font-medium transition-colors",
				isActive
					? "bg-primary text-white hover:bg-primary-hover"
					: "text-neutral-darker hover:bg-primary-light hover:text-primary",
				className,
			)}
			{...props}
		>
			{children}
		</button>
	);
}

function PaginationPrevious({
	className,
	text = "Previous",
	...props
}: React.ComponentProps<typeof PaginationLink> & { text?: string }) {
	return (
		<PaginationLink
			aria-label="Go to previous page"
			className={cn(
				"w-fit gap-1.5 rounded-full px-3 text-neutral-800 hover:bg-primary-light hover:text-primary",
				className,
			)}
			{...props}
		>
			<ChevronLeftIcon className="size-4" />
			<span className="hidden sm:block">{text}</span>
		</PaginationLink>
	);
}

function PaginationNext({
	className,
	text = "Next",
	...props
}: React.ComponentProps<typeof PaginationLink> & { text?: string }) {
	return (
		<PaginationLink
			aria-label="Go to next page"
			className={cn(
				"w-fit gap-1.5 rounded-full px-3 text-neutral-800 hover:bg-primary-light hover:text-primary",
				className,
			)}
			{...props}
		>
			<span className="hidden sm:block">{text}</span>
			<ChevronRightIcon className="size-4" />
		</PaginationLink>
	);
}

function PaginationEllipsis({
	className,
	...props
}: React.ComponentProps<"span">) {
	return (
		<span
			aria-hidden
			data-slot="pagination-ellipsis"
			className={cn(
				"flex size-9 items-center justify-center text-neutral-800",
				className,
			)}
			{...props}
		>
			<MoreHorizontalIcon className="size-4" />
			<span className="sr-only">More pages</span>
		</span>
	);
}

export {
	Pagination,
	PaginationContent,
	PaginationEllipsis,
	PaginationItem,
	PaginationLink,
	PaginationNext,
	PaginationPrevious,
};
