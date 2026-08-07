"use client";

import React from "react";
import PicSlide from "../../../features/auth/components/PicSlide";
import RegisterForm from "../../../features/auth/components/RegisterForm";

export default function Page() {
	return (
		<div className="pt-20 sm:pt-32 lg:pt-40">
			<div className="custom-container flex flex-col gap-10 lg:flex-row lg:items-center lg:gap-20">
				<div className="lg:flex-1">
					<PicSlide />
				</div>
				<div className="max-w-lg w-full mx-auto lg:flex-1">
					<RegisterForm />
				</div>
			</div>
		</div>
	);
}
