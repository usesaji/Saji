/* eslint-disable @next/next/no-img-element */
import React from "react";

const colors = [
	"bg-accent-light text-accent",
	"bg-secondary-light text-secondary-dark",
	"bg-primary-light text-primary",
	"bg-warning-100 text-warning-700",
];

interface MemberAvatarProps {
	name: string;
	isSelf?: boolean;
	size?: string;
	colorIndex?: number;
}

export default function MemberAvatar({
	name,
	isSelf,
	size = "w-11 h-11",
	colorIndex = 0,
}: MemberAvatarProps) {
	if (isSelf) {
		return (
			<div className={`${size} rounded-full overflow-hidden shrink-0`}>
				<img src="/images/user.jpg" alt={name} className="w-full h-full object-cover" />
			</div>
		);
	}

	const initials = name
		.split(" ")
		.map((part) => part[0])
		.join("")
		.slice(0, 2)
		.toUpperCase();

	return (
		<div
			className={`${size} rounded-full flex items-center justify-center shrink-0 font-semibold text-xs ${colors[colorIndex % colors.length]}`}
		>
			{initials}
		</div>
	);
}
