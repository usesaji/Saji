"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navItems } from "../../lib/utils/nav-items";

export default function Navbar() {
	const pathname = usePathname();

	return (
		<aside className="">
			<nav className="bg-white fixed inset-x-0 bottom-0 custom-container py-3.5">
				<ul className="flex items-center justify-between">
					{navItems.map(({ href, label, Icon }) => {
						const active = pathname === href;

						return (
							<li key={href}>
								<Link
									href={href}
									className="flex flex-col items-center space-y-1"
								>
									<Icon active={active} />

									<span
										className={`text-[10px] font-medium transition-colors ${
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
	);
}
