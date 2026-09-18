"use client";
import React from "react";
import { useMediaQuery } from "../../hooks/use-media-query";
import { cn } from "../../lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "./drawer";

// Bottom sheet on mobile, centered dialog on desktop — matches Tailwind's `sm` breakpoint.
const DESKTOP_QUERY = "(min-width: 640px)";

interface ResponsiveModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	children: React.ReactNode;
	drawerClassName?: string;
	dialogClassName?: string;
}

export function ResponsiveModal({
	open,
	onOpenChange,
	children,
	drawerClassName,
	dialogClassName,
}: ResponsiveModalProps) {
	const isDesktop = useMediaQuery(DESKTOP_QUERY);

	if (isDesktop) {
		return (
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent
					showCloseButton={false}
					className={cn(
						"bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full ring-0 shadow-xl",
						dialogClassName,
					)}
				>
					{children}
				</DialogContent>
			</Dialog>
		);
	}

	return (
		<Drawer open={open} onOpenChange={onOpenChange}>
			<DrawerContent
				className={cn(
					"bg-white rounded-t-3xl border-0 p-6 pt-4 sm:p-8 shadow-xl",
					drawerClassName,
				)}
			>
				<span className="mx-auto block h-1.25 w-10 rounded-full bg-neutral-light mb-5" />
				{children}
			</DrawerContent>
		</Drawer>
	);
}

export function ResponsiveModalTitle({
	className,
	children,
}: {
	className?: string;
	children: React.ReactNode;
}) {
	const isDesktop = useMediaQuery(DESKTOP_QUERY);
	const Title = isDesktop ? DialogTitle : DrawerTitle;
	return <Title className={className}>{children}</Title>;
}

export function ResponsiveModalDescription({
	className,
	children,
}: {
	className?: string;
	children: React.ReactNode;
}) {
	const isDesktop = useMediaQuery(DESKTOP_QUERY);
	const Description = isDesktop ? DialogDescription : DrawerDescription;
	return <Description className={className}>{children}</Description>;
}
