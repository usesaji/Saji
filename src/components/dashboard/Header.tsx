"use client";

import Image from "next/image";
import Link from "next/link";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { pageRoutes } from "../../config/routes";
import InputField from "../ui/custom/InputField";
import NotificationBell from "../../features/notifications/NotificationBell";
import { CiSearch } from "react-icons/ci";
import { useApi } from "../../lib/hooks/useApi";
import { profile as profileApi, assetUrl } from "../../lib/api";

const AVATAR_PLACEHOLDER = "/images/user.jpg";

function greeting(): string {
	const h = new Date().getHours();
	if (h < 12) return "Good Morning";
	if (h < 17) return "Good Afternoon";
	return "Good Evening";
}

export default function Header() {
	// Real user identity for the greeting + avatar. Token is browser-only, so
	// this fetch (and thus the component) runs client-side.
	const { data } = useApi(() => profileApi.show(), []);
	const router = useRouter();
	const [query, setQuery] = useState("");

	const firstName = data?.name?.split(" ")[0] ?? "";
	const avatar = assetUrl(data?.avatar_url, AVATAR_PLACEHOLDER);

	const onSearch = (e: React.FormEvent) => {
		e.preventDefault();
		const q = query.trim();
		if (q) router.push(pageRoutes.dashboardRoutes.SEARCH(q));
	};

	return (
		<header className="bg-white max-lg:fixed max-lg:inset-x-0 max-lg:top-0 z-1001">
			<div className="flex justify-between items-center py-6 lg:py-10 dashboard-custom-container gap-10">
				<div className="flex items-center gap-7.5 lg:w-full">
					<div className="flex max-lg:flex-col lg:gap-2">
						<span className="text-base whitespace-nowrap max-lg:font-medium md:text-xl">
							{firstName ? `Yo ${firstName}!` : "Welcome!"}
						</span>{" "}
						<span className="max-sm:text-[10px] max-md:-mt-0.5 max-lg:text-sm lg:text-xl whitespace-nowrap">
							{greeting()}
						</span>{" "}
					</div>

					<form
						onSubmit={onSearch}
						className="max-md:hidden relative w-full min-w-100 max-w-120"
					>
						<CiSearch className="absolute z-10 text-2xl text-neutral-light-active top-3 left-4" />
						<InputField
							name="search"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							type="text"
							className="w-full -mt-2 pl-12 bg-neutral-comment"
							placeholder="Search groups or history.."
						/>
					</form>
				</div>
				<div className="flex items-center gap-3.5">
					{/* A real unread count now backs this, so it is finally labelled
					    "Notifications" rather than "Activity". Rows are raised the
					    moment an action completes and pushed over Realtime — see
					    `useNotifications`. */}
					<NotificationBell />
					<Link
						href={pageRoutes.dashboardRoutes.ME}
						className="h-10.75 w-10.75 rounded-full overflow-hidden bg-primary items-center justify-center"
					>
						<Image
							className="h-full w-full object-cover"
							height={100}
							width={100}
							src={avatar}
							alt={data?.name ?? "User Profile Picture"}
						/>
					</Link>
				</div>
			</div>
		</header>
	);
}
