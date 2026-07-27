import Image from "next/image";
import Link from "next/link";
import React from "react";
import { IoNotifications } from "react-icons/io5";
import { pageRoutes } from "../../config/routes";
// import Logo from "../shared/Logo";

export default function Header() {
	return (
		<header className="bg-white max-lg:fixed max-lg:inset-x-0 max-lg:top-0">
			<div className="flex justify-between items-center py-4 dashboard-custom-container">
				{/* <div>
					<Logo />
				</div> */}
				<div className="flex flex-col">
					<span className="text-base font-medium md:text-xl">Yo Dean!</span>{" "}
					<span className="text-[10px] max-md:-mt-0.5 md:text-sm">
						Good Morning
					</span>{" "}
				</div>
				<div className="flex items-center gap-3.5">
					<IoNotifications className="text-2xl md:text-3xl" />
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
