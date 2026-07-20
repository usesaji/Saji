"use client";
import { Button } from "../ui/button";
import Logo from "../shared/Logo";
import { LuMenu } from "react-icons/lu";
import { useState } from "react";
import { IoMdClose } from "react-icons/io";
import { pageRoutes } from "@/config/routes";

const Header = () => {
	const [isMenuOpen, setIsMenuOpen] = useState(false);

	return (
		<header className="fixed inset-x-0 top-0 bg-white lg:px-10 xl:px-20 py-5 sm:py-8 z-40">
			<div className="custom-container flex justify-between items-center ">
				<div className="flex items-center gap-10 lg:gap-13">
					<Logo />
					<ul className="max-md:hidden flex gap-10 lg:gap-13 text-xl lg:text-2xl">
						<li>
							<a href="">About</a>
						</li>
						<li>
							<a href="">Contact</a>
						</li>
						<li>
							<a href="">Help</a>
						</li>
					</ul>
				</div>
				<div className="flex gap-2.5 max-md:hidden">
					<Button variant="secondary" href={pageRoutes.login}>
						Log In
					</Button>
					<Button variant="default" href={pageRoutes.register}>
						Get Started
					</Button>
				</div>

				<div className="flex gap-2.5 items-center md:hidden">
					<Button variant="default" href={pageRoutes.register}>
						Get Started
					</Button>
					<div>
						<LuMenu
							className="text-3xl cursor-pointer"
							onClick={() => setIsMenuOpen(true)}
						/>
					</div>
				</div>

				{/* Overlay - stays mounted, fades in/out via opacity so panel can slide */}
				<div
					className={`fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-[2px] transition-opacity duration-300 ${
						isMenuOpen
							? "opacity-100 pointer-events-auto"
							: "opacity-0 pointer-events-none"
					}`}
					onClick={() => setIsMenuOpen(false)}
				>
					{/* Panel - slides in/out via translate-x */}
					<div
						className={`relative h-screen w-3/4 sm:w-1/2 overflow-hidden bg-white p-6 flex flex-col gap-8 shadow-2xl transition-transform duration-300 ease-in-out ${
							isMenuOpen ? "translate-x-0" : "translate-x-full"
						}`}
						onClick={(e) => e.stopPropagation()}
					>
						{/* Decorative curvy background pattern */}
						<svg
							className="opacity-40 pointer-events-none absolute inset-0 h-full w-full"
							xmlns="http://www.w3.org/2000/svg"
							preserveAspectRatio="none"
						>
							<defs>
								<pattern
									id="header-menu-waves"
									x="0"
									y="0"
									width="200"
									height="120"
									patternUnits="userSpaceOnUse"
								>
									<path
										d="M0 60 C 25 20, 75 20, 100 60 S 175 100, 200 60"
										fill="none"
										stroke="#4100f5"
										strokeOpacity="0.07"
										strokeWidth="2"
									/>
									<path
										d="M0 100 C 25 60, 75 60, 100 100 S 175 140, 200 100"
										fill="none"
										stroke="#4100f5"
										strokeOpacity="0.05"
										strokeWidth="2"
									/>
									<path
										d="M0 20 C 25 -20, 75 -20, 100 20 S 175 60, 200 20"
										fill="none"
										stroke="#4100f5"
										strokeOpacity="0.05"
										strokeWidth="2"
									/>
								</pattern>
								<radialGradient
									id="header-menu-fade"
									cx="100%"
									cy="0%"
									r="100%"
								>
									<stop offset="0%" stopColor="#4100f5" stopOpacity="0.10" />
									<stop offset="60%" stopColor="#4100f5" stopOpacity="0" />
								</radialGradient>
							</defs>
							<rect width="100%" height="100%" fill="url(#header-menu-waves)" />
							{/* Soft blob accents */}
							<circle
								cx="90%"
								cy="8%"
								r="110"
								fill="#4100f5"
								fillOpacity="0.06"
							/>
							<circle
								cx="-5%"
								cy="85%"
								r="140"
								fill="#4100f5"
								fillOpacity="0.05"
							/>
							<rect width="100%" height="100%" fill="url(#header-menu-fade)" />
						</svg>

						<div className="relative flex justify-end">
							<IoMdClose
								className="text-3xl cursor-pointer"
								onClick={() => setIsMenuOpen(false)}
							/>
						</div>
						<ul className="relative flex flex-col gap-6 text-xl">
							<li>
								<a href="" onClick={() => setIsMenuOpen(false)}>
									About
								</a>
							</li>
							<li>
								<a href="" onClick={() => setIsMenuOpen(false)}>
									Contact
								</a>
							</li>
							<li>
								<a href="" onClick={() => setIsMenuOpen(false)}>
									Help
								</a>
							</li>
						</ul>
						<Button
							variant="secondary"
							href={pageRoutes.login}
							className="relative w-full"
						>
							Log In
						</Button>
					</div>
				</div>
			</div>
		</header>
	);
};

export default Header;
