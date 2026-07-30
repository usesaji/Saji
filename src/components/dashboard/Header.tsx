"use client";
import Image from "next/image";
import Link from "next/link";
import React, { useState } from "react";
import { IoNotifications } from "react-icons/io5";
import { pageRoutes } from "../../config/routes";
import InputField from "../ui/custom/InputField";
// import Logo from "../shared/Logo";
import { CiSearch } from "react-icons/ci";

export default function Header() {
	const [search, setSearch] = useState("");

	return (
		<header className="bg-white max-lg:fixed max-lg:inset-x-0 max-lg:top-0 z-1001">
			<div className="flex justify-between items-center py-6 lg:py-10 dashboard-custom-container gap-10">
				{/* <div>
					<Logo />
				</div> */}
				<div className="flex items-center gap-7.5 lg:w-full">
					<div className="flex max-lg:flex-col lg:gap-2">
						<span className="text-base whitespace-nowrap max-lg:font-medium md:text-xl">
							Yo Dean!
						</span>{" "}
						<span className="max-sm:text-[10px] max-md:-mt-0.5 max-lg:text-sm lg:text-xl whitespace-nowrap">
							Good Morning
						</span>{" "}
					</div>

					<div className="max-md:hidden relative w-full min-w-100 max-w-120">
						<CiSearch className="absolute z-10 text-2xl text-neutral-light-active top-3 left-4" />
						<InputField
							name="search"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							type="text"
							className="w-full -mt-2 pl-12 bg-neutral-comment"
							placeholder="Search groups or history.."
						/>
					</div>
				</div>
				<div className="flex items-center gap-3.5">
					<Link
						href={pageRoutes.dashboardRoutes.ACTIVITY}
						className="text-2xl md:text-3xl hover:opacity-75 transition-opacity"
					>
						<IoNotifications />
					</Link>
					<Link
						href={pageRoutes.dashboardRoutes.ME}
						className="h-10.75 w-10.75 rounded-full overflow-hidden bg-primary items-center justify-center"
					>
						<Image
							className="h-full w-full object-cover"
							height={100}
							width={100}
							src="/images/user.jpg"
							alt="User Profile Picture"
						/>
					</Link>
				</div>
			</div>
		</header>
	);
}
