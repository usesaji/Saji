"use client";
import React from "react";
import { HiOutlineBookmark } from "react-icons/hi2";
import { Button } from "../../components/ui/button";
import {
	ResponsiveModal,
	ResponsiveModalDescription,
	ResponsiveModalTitle,
} from "../../components/ui/responsive-modal";

interface LogoutConfirmSheetProps {
	open: boolean;
	isLoggingOut: boolean;
	onClose: () => void;
	onLogoutWithoutSaving: () => void;
	onSaveAndLogout: () => void;
}

export default function LogoutConfirmSheet({
	open,
	isLoggingOut,
	onClose,
	onLogoutWithoutSaving,
	onSaveAndLogout,
}: LogoutConfirmSheetProps) {
	return (
		<ResponsiveModal
			open={open}
			onOpenChange={(next) => {
				if (!next && !isLoggingOut) onClose();
			}}
		>
			<div className="max-w-md mx-auto w-full flex flex-col items-center text-center">
				<span className="w-16 h-16 rounded-full bg-primary-light flex items-center justify-center">
					<HiOutlineBookmark className="text-primary text-2xl" />
				</span>

				<ResponsiveModalTitle className="text-base md:text-lg font-semibold text-neutral-dark mt-4">
					Do you want to save login?
				</ResponsiveModalTitle>
				<ResponsiveModalDescription className="text-xs md:text-sm font-light text-neutral-light-active mt-2 leading-relaxed">
					You can save your login information for the next time you need to
					login so you do not login with a password information.
				</ResponsiveModalDescription>

				<div className="flex items-center gap-3 mt-6 w-full">
					<button
						type="button"
						onClick={onLogoutWithoutSaving}
						disabled={isLoggingOut}
						className="flex-1 h-12 rounded-full bg-neutral-comment text-accent font-semibold text-sm cursor-pointer border-0 disabled:cursor-not-allowed disabled:opacity-60"
					>
						No & Log out
					</button>
					<Button
						type="button"
						onClick={onSaveAndLogout}
						isLoading={isLoggingOut}
						className="flex-1"
					>
						Save &amp; Log out
					</Button>
				</div>
			</div>
		</ResponsiveModal>
	);
}
