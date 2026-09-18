"use client";
import CreateProfileForm from "../../../../features/auth/components/CreateProfileForm";

export default function Page() {
	return (
		<div className="pt-20 sm:pt-32 lg:pt-40">
			<div className="custom-container">
				<div className="max-w-lg mx-auto w-full">
					<CreateProfileForm />
				</div>
			</div>
		</div>
	);
}
