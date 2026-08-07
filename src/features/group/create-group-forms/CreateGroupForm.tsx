"use client";
import React from "react";
import FirstStep from "./FirstStep";
import SecondStep from "./SecondStep";
import Review from "./Review";
import { useCreateGroupStore } from "../../../lib/store/create-group-store";
import { useRouter } from "next/navigation";
import { HiArrowLeft } from "react-icons/hi2";

export default function CreateGroupForm() {
	const currentStep = useCreateGroupStore((state) => state.currentStep);
	const groupCreated = useCreateGroupStore((state) => state.groupCreated);
	const store = useCreateGroupStore();
	const router = useRouter();

	const handleBack = () => {
		if (currentStep > 1) {
			store.previousStep();
		} else {
			router.back();
		}
	};

	return (
		<div className="mx-auto md:max-w-xl lg:max-w-3xl w-full px-0 sm:px-4 py-2 transition-all duration-300">
			<div className="space-y-6">
				{!groupCreated && (
					<div
						onClick={handleBack}
						className="cursor-pointer w-fit flex items-center gap-2 text-neutral-dark hover:opacity-75 transition-opacity"
					>
						<HiArrowLeft className="text-xl md:text-2xl" />
						<div className="text-sm font-medium">Back</div>
					</div>
				)}

				{currentStep === 1 && <FirstStep />}
				{currentStep === 2 && <SecondStep />}
				{currentStep === 3 && <Review />}
			</div>
		</div>
	);
}
