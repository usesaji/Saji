"use client";
import LoginForm from "../../../features/auth/components/LoginForm";
import Image from "next/image";

export default function Page() {
	return (
		<div className="pt-24 sm:pt-32 lg:pt-40">
			<div className="custom-container flex flex-col gap-10 lg:flex-row lg:items-center lg:gap-20">
				<div className="lg:flex-1">
					<div className="h-70 sm:h-105">
						<Image
							src="/images/auth/login-illustration.svg"
							alt="Lady and Guy exchanging Coins Illustration"
							className="object-contain h-full w-full"
							width={500}
							height={500}
						/>
					</div>
				</div>
				<div className="max-w-lg w-full mx-auto lg:flex-1">
					<LoginForm />
				</div>
			</div>
		</div>
	);
}
