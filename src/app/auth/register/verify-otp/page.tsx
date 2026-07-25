"use client";

import { useSearchParams } from "next/navigation";
import VerifyOtpForm from "../../../../features/auth/components/VerifyOTPForm";

export default function VerifyOtpPage() {
	const params = useSearchParams();
	const email = params.get("email");

	return (
		<div className="max-w-md mx-auto  min-h-screen flex flex-col items-center justify-center">
			<div className="mb-8 text-center">
				<h1 className="text-3xl font-semibold">Verify your email</h1>

				<p className="mt-2 text-muted-foreground">
					Enter the 4-digit code sent to your email address{" "}
					<span className="text-primary">{email}.</span>
				</p>
			</div>

			<VerifyOtpForm />
		</div>
	);
}
