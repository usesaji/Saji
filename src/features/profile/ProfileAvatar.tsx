"use client";
import Link from "next/link";
import React, { useRef, useState } from "react";
import { HiOutlineCamera, HiOutlinePencil, HiOutlineUser } from "react-icons/hi2";
import { pageRoutes } from "../../config/routes";

const DEFAULT_AVATAR = "/images/user.jpg";

export default function ProfileAvatar() {
	const [avatarSrc, setAvatarSrc] = useState<string | null>(DEFAULT_AVATAR);
	const objectUrlRef = useRef<string | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;

		if (objectUrlRef.current) {
			URL.revokeObjectURL(objectUrlRef.current);
		}

		const url = URL.createObjectURL(file);
		objectUrlRef.current = url;
		setAvatarSrc(url);
	};

	return (
		<div className="flex flex-col items-center text-center">
			<input
				ref={fileInputRef}
				type="file"
				accept="image/*"
				className="hidden"
				onChange={handleFileChange}
			/>

			<div className="relative">
				<div className="h-25 w-25 md:h-28 md:w-28 rounded-full overflow-hidden bg-primary-light flex items-center justify-center">
					{avatarSrc ? (
						// eslint-disable-next-line @next/next/no-img-element
						<img
							src={avatarSrc}
							alt="Profile Picture"
							className="h-full w-full object-cover"
						/>
					) : (
						<HiOutlineUser className="text-primary text-5xl" />
					)}
				</div>
				<button
					type="button"
					onClick={() => fileInputRef.current?.click()}
					className="absolute bottom-0.5 right-0.5 h-8 w-8 rounded-full bg-primary text-white flex items-center justify-center border-2 border-white cursor-pointer"
				>
					<HiOutlineCamera className="text-sm" />
				</button>
			</div>

			<h3 className="text-xl md:text-2xl font-semibold text-neutral-dark mt-4">
				Dean Ogude
			</h3>
			<Link
				href={pageRoutes.dashboardRoutes.PROFILE_PERSONAL_INFO}
				className="flex items-center gap-1.5 text-sm text-primary hover:text-primary-hover mt-1"
			>
				@deanogude
				<HiOutlinePencil className="text-xs" />
			</Link>
		</div>
	);
}
