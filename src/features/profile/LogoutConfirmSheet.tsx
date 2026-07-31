"use client";
import React from "react";
import { HiOutlineBookmark } from "react-icons/hi2";
import { Button } from "../../components/ui/button";

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
	if (!open) return null;

	return (
		<div
			className="fixed inset-0 z-1100 flex items-end sm:items-center justify-center bg-black/40 px-0 sm:px-4"
			onClick={onClose}
		>
			<div
				onClick={(e) => e.stopPropagation()}
				className="bg-white rounded-t-3xl sm:rounded-3xl p-6 pt-3 sm:p-8 w-full max-w-md flex flex-col items-center text-center shadow-xl"
			>
				<span className="sm:hidden w-10 h-1.25 rounded-full bg-neutral-light mb-5" />

				<span className="w-16 h-16 rounded-full bg-primary-light flex items-center justify-center">
					<HiOutlineBookmark className="text-primary text-2xl" />
				</span>

				<h4 className="text-base md:text-lg font-semibold text-neutral-dark mt-4">
					Do you want to save login?
				</h4>
				<p className="text-xs md:text-sm font-light text-neutral-light-active mt-2 leading-relaxed">
					You can save your login information for the next time you need to
					login so you do not login with a password information.
				</p>

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
		</div>
	);
}
