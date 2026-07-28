"use client";
import { HiOutlinePlusSmall } from "react-icons/hi2";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { navItems } from "../../lib/utils/nav-items";
import Logo from "../shared/Logo";
import { Button } from "../ui/button";
// import Image from "next/image";
// import { pageRoutes } from "../../config/routes";

export default function Navbar() {
	const pathname = usePathname();

	return (
		<>
			{/* DESKTOP NAV */}
			<aside className="max-lg:hidden mt-10 bg-white h-screen pb-20">
				<div className="scale-[0.95] px-7.5">
					<Logo />
				</div>
				<div className="flex flex-col justify-between h-full border-r border-r-neutral-light-hover">
					<nav className="mt-15 pl-7.5">
						<ul className="flex justify-between flex-col bg-white gap-10">
							{navItems.map(({ href, label, Icon }) => {
								const active = pathname === href;
								return (
									<li key={href}>
										<Link href={href} className="flex items-center ">
											<div
												className={`mr-4 xl:mr-5.5 w-1.25 h-[28.2px] rounded-[21.1px] ${!active ? "bg-white" : "bg-primary"}`}
											></div>

											<div className="scale-[0.9]">
												<Icon active={active} />
											</div>

											<span
												className={`text-lg xl:text-xl ml-5 xl:ml-7 transition hover:text-neutral-dark ${
													active
														? "text-neutral-dark"
														: "text-neutral-light-hover"
												}`}
											>
												{label}
											</span>
										</Link>
									</li>
								);
							})}
						</ul>
					</nav>

					<div className="flex flex-col items-center pb-10 px-7.5 gap-6.5">
						{/* <Link
							href={pageRoutes.dashboardRoutes.ME}
							className="flex items-center bg-[#f8f8f8] w-full py-[8.5px] px-3.5 rounded-[8.5px] gap-[8.3px]"
						>
							<div className="h-12.75 w-12.75 rounded-full overflow-hidden bg-primary items-center justify-center">
								<Image
									className="h-full w-full object-cover"
									height={100}
									width={100}
									src="/images/user.jpg"
									alt="User Profile Picture"
								/>
							</div>

							<div className="">
								<h4 className="font-medium">Dean Ogude</h4>
								<p className="-mt-0.5 text-xs text-[#646464]">View Profile</p>
							</div>
						</Link> */}
						<div className="w-full">
							<Button className="flex gap-3 w-full">
								<span>Create Group</span>
								<HiOutlinePlusSmall className="scale-[1.8]" />
							</Button>
						</div>
					</div>
				</div>
			</aside>

			{/* MOBILE NAV */}
			<aside className=" bg-white fixed inset-x-0 bottom-0 lg:hidden z-50">
				<nav className="custom-container py-3.5 sm:py-5">
					<ul className="flex items-center justify-between">
						{navItems.map(({ href, label, Icon }) => {
							const active = pathname === href;
							return (
								<li key={href}>
									<Link
										href={href}
										className="flex max-lg:flex-col items-center space-y-1"
									>
										<Icon active={active} />

										<span
											className={`text-[10px] sm:text-xs font-medium transition-colors ${
												active ? "text-primary" : "text-neutral-light-hover"
											}`}
										>
											{label}
										</span>
									</Link>
								</li>
							);
						})}
					</ul>
				</nav>
			</aside>
		</>
	);
}
