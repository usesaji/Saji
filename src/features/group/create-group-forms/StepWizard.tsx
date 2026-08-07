import React from "react";

const StepWizard = ({ step = 1 }: { step: number }) => {
	return (
		<div className="flex items-center mt-3 gap-5">
			<p className="whitespace-nowrap">Step {step}</p>
			<div className="flex items-center w-full gap-1.25">
				<div className="h-1.25 w-1/5 bg-primary rounded-[900px]"></div>
				<div
					className={`h-1.25 w-1/5 ${step === 2 || step === 3 ? "bg-primary" : "bg-primary-light"} rounded-[900px]`}
				></div>
				<div
					className={`h-1.25 w-3/5 ${step === 3 ? "bg-primary" : "bg-primary-light"} rounded-[900px]`}
				></div>
			</div>
		</div>
	);
};

export default StepWizard;
