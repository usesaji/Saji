import Image from "next/image";
import React from "react";
import { IoNotifications } from "react-icons/io5";

export default function Header() {
	return (
		<header className="bg-red-300 fixed inset-x-0 top-0">
			<div className="flex justify-between items-center py-4 custom-container">
				<div className="flex flex-col">
					<span className="text-base font-medium">Yo Dean!</span>{" "}
					<span className="text-[10px] -mt-0.5">Good Morning</span>{" "}
				</div>
				<div className="flex items-center gap-3.5">
					<IoNotifications className="text-2xl" />
					<div className="h-10.75 w-10.75 rounded-full overflow-hidden bg-primary items-center justify-center">
						<Image
							className="h-full w-full object-cover"
							height={100}
							width={100}
							src="/images/user.jpg"
							alt="User Profile Picture"
						/>
					</div>
				</div>
			</div>
		</header>
	);
}
