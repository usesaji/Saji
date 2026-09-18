import Link from "next/link";
import React from "react";
import { HiChevronRight } from "react-icons/hi2";

export interface ProfileMenuItem {
	key: string;
	icon: React.ReactNode;
	label: string;
	href?: string;
	onClick?: () => void;
	iconBg?: string;
	iconColor?: string;
	labelColor?: string;
}

interface ProfileMenuListProps {
	items: ProfileMenuItem[];
}

export default function ProfileMenuList({ items }: ProfileMenuListProps) {
	return (
		<div className="bg-white border border-neutral-light rounded-[20px] overflow-hidden">
			{items.map((item, index) => {
				const content = (
					<>
						<span
							className={`w-9 h-9 md:w-10 md:h-10 rounded-full flex items-center justify-center shrink-0 ${
								item.iconBg ?? "bg-primary-light"
							} ${item.iconColor ?? "text-primary"}`}
						>
							{item.icon}
						</span>
						<span
							className={`flex-1 text-sm md:text-base font-medium text-left ${
								item.labelColor ?? "text-neutral-dark"
							}`}
						>
							{item.label}
						</span>
						<HiChevronRight
							className={`text-base shrink-0 ${item.labelColor ?? "text-neutral-light-active"}`}
						/>
					</>
				);

				const rowClassName = `flex items-center gap-3 px-4 md:px-5 py-4 w-full text-left cursor-pointer hover:bg-neutral-comment transition-colors ${
					index !== items.length - 1 ? "border-b border-neutral-light" : ""
				}`;

				if (item.href) {
					return (
						<Link key={item.key} href={item.href} className={rowClassName}>
							{content}
						</Link>
					);
				}

				return (
					<button
						key={item.key}
						type="button"
						onClick={item.onClick}
						className={`${rowClassName} bg-transparent border-0`}
					>
						{content}
					</button>
				);
			})}
		</div>
	);
}
