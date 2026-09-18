"use client";
import { useRouter } from "next/navigation";
import React from "react";
import { HiArrowLeft } from "react-icons/hi2";

const GoBack = () => {
	const router = useRouter();

	const goBack = () => {
		router.back();
	};

	return (
		<div
			onClick={goBack}
			className=" cursor-pointer w-fit flex items-center gap-2"
		>
			<HiArrowLeft className="text-xl md:text-2xl" />
			<div>Back</div>
		</div>
	);
};

export default GoBack;
