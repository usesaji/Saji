"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
	HiOutlineArrowRightOnRectangle,
	HiOutlineBuildingLibrary,
	HiOutlineDocumentDuplicate,
	HiOutlineDocumentText,
	HiOutlineLockClosed,
	HiOutlineQuestionMarkCircle,
	HiOutlineUser,
} from "react-icons/hi2";
// import GoBack from "../../components/dashboard/GoBack";
import { pageRoutes } from "../../config/routes";
import LogoutConfirmSheet from "./LogoutConfirmSheet";
import ProfileAvatar from "./ProfileAvatar";
import ProfileIncompleteBanner from "./ProfileIncompleteBanner";
import ProfileMenuList, { ProfileMenuItem } from "./ProfileMenuList";

const PROFILE_COMPLETION_PERCENT = 48;

export default function ProfileView() {
	const router = useRouter();
	const [showIncompleteBanner, setShowIncompleteBanner] = useState(true);
	const [showLogoutSheet, setShowLogoutSheet] = useState(false);
	const [isLoggingOut, setIsLoggingOut] = useState(false);

	const accountItems: ProfileMenuItem[] = [
		{
			key: "personal-info",
			icon: <HiOutlineUser />,
			label: "Personal Info",
			href: pageRoutes.dashboardRoutes.PROFILE_PERSONAL_INFO,
		},
		{
			key: "password-security",
			icon: <HiOutlineLockClosed />,
			label: "Password & Security",
			href: pageRoutes.dashboardRoutes.PROFILE_PASSWORD_SECURITY,
		},
		{
			key: "withdrawal-info",
			icon: <HiOutlineBuildingLibrary />,
			label: "Withdrawal Info",
			href: pageRoutes.dashboardRoutes.PROFILE_WITHDRAWAL_INFO,
		},
		{
			key: "transaction-history",
			icon: <HiOutlineDocumentText />,
			label: "Transaction history",
			href: pageRoutes.dashboardRoutes.ACTIVITY,
		},
	];

	const supportItems: ProfileMenuItem[] = [
		{
			key: "help-support",
			icon: <HiOutlineQuestionMarkCircle />,
			label: "Help & Support",
			href: pageRoutes.dashboardRoutes.PROFILE_HELP_SUPPORT,
		},
		{
			key: "generate-statement",
			icon: <HiOutlineDocumentDuplicate />,
			label: "Generate Statement",
			href: pageRoutes.dashboardRoutes.PROFILE_STATEMENT,
		},
	];

	const logoutItem: ProfileMenuItem[] = [
		{
			key: "log-out",
			icon: <HiOutlineArrowRightOnRectangle />,
			label: "Log Out",
			iconBg: "bg-accent-light",
			iconColor: "text-accent",
			labelColor: "text-accent",
			onClick: () => setShowLogoutSheet(true),
		},
	];

	const finishLogout = () => {
		setIsLoggingOut(true);
		setTimeout(() => {
			router.push(pageRoutes.authRoutes.LOGIN);
		}, 900);
	};

	return (
		<div className="mx-auto md:max-w-xl lg:max-w-2xl w-full px-0 sm:px-4 py-2">
			<div className="space-y-6">
				{/* <div className="flex items-center justify-between">
					<GoBack />
				</div> */}

				<ProfileAvatar />

				{showIncompleteBanner && (
					<ProfileIncompleteBanner
						percentComplete={PROFILE_COMPLETION_PERCENT}
						onDismiss={() => setShowIncompleteBanner(false)}
					/>
				)}

				<ProfileMenuList items={accountItems} />
				<ProfileMenuList items={supportItems} />
				<ProfileMenuList items={logoutItem} />
			</div>

			<LogoutConfirmSheet
				open={showLogoutSheet}
				isLoggingOut={isLoggingOut}
				onClose={() => !isLoggingOut && setShowLogoutSheet(false)}
				onLogoutWithoutSaving={finishLogout}
				onSaveAndLogout={finishLogout}
			/>
		</div>
	);
}
