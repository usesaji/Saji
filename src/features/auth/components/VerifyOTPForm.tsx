"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormMessage,
} from "@/components/ui/form";

import {
	InputOTP,
	InputOTPGroup,
	InputOTPSlot,
} from "@/components/ui/input-otp";

import { Button } from "@/components/ui/button";

import {
	VerifyOtpSchema,
	VerifyOtpValues,
} from "@/lib/validations/authValidations";
import { toast } from "../../../lib/utils/toast";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { pageRoutes } from "../../../config/routes";
import { ApiError, auth, fieldErrors } from "../../../lib/api";
import { signupSession } from "../../../lib/auth/signup-session";

export default function VerifyOtpForm() {
	const [isLoading, setIsLoading] = useState(false);
	const [isResending, setIsResending] = useState(false);
	const router = useRouter();
	const searchParams = useSearchParams();

	// The address comes through the URL; sessionStorage is the fallback for a
	// refresh that drops the query string.
	const email = searchParams.get("email") ?? signupSession.getEmail() ?? "";

	const form = useForm<VerifyOtpValues>({
		resolver: zodResolver(VerifyOtpSchema),
		mode: "onChange",
		defaultValues: {
			otp: "",
		},
	});

	const onSubmit = async (values: VerifyOtpValues) => {
		if (!email) {
			toast.error("Start again so we can send a new code.", "Missing email");
			router.push(pageRoutes.authRoutes.REGISTER);
			return;
		}

		setIsLoading(true);

		try {
			const { signup_token } = await auth.verifyOtp({
				email,
				otp: values.otp,
			});

			// Proof of verification — the Create Profile step presents this.
			signupSession.setEmail(email);
			signupSession.setToken(signup_token);

			toast.success("Your email has been verified", "Verification Successful");
			router.push(pageRoutes.authRoutes.CREATE_PROFILE);
		} catch (err) {
			const otpError = fieldErrors(err).otp;
			if (otpError) form.setError("otp", { message: otpError });

			toast.error(
				err instanceof ApiError ? err.message : "Something went wrong.",
				"Verification Failed",
			);
		} finally {
			setIsLoading(false);
		}
	};

	const onResend = async () => {
		if (!email) {
			router.push(pageRoutes.authRoutes.REGISTER);
			return;
		}

		setIsResending(true);

		try {
			await auth.startRegistration({ email });
			form.reset({ otp: "" });
			toast.success("Check your email for the new code", "Code Resent");
		} catch (err) {
			toast.error(
				err instanceof ApiError ? err.message : "Something went wrong.",
				"Could not resend code",
			);
		} finally {
			setIsResending(false);
		}
	};

	const {
		formState: { isDirty, isSubmitting, isValid },
	} = form;

	return (
		<Form {...form}>
			<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
				<FormField
					control={form.control}
					name="otp"
					render={({ field }) => (
						<FormItem>
							<FormControl>
								<InputOTP maxLength={4} {...field}>
									<InputOTPGroup className="gap-3">
										<InputOTPSlot index={0} className="h-14 w-14 rounded-xl" />
										<InputOTPSlot index={1} className="h-14 w-14 rounded-xl" />
										<InputOTPSlot index={2} className="h-14 w-14 rounded-xl" />
										<InputOTPSlot index={3} className="h-14 w-14 rounded-xl" />
									</InputOTPGroup>
								</InputOTP>
							</FormControl>

							<FormMessage />
						</FormItem>
					)}
				/>

				<Button
					type="submit"
					className="w-full"
					disabled={!isDirty || !isValid || isSubmitting}
					isLoading={isLoading}
				>
					Verify OTP
				</Button>

				<p className="text-center text-sm">
					Didn&apos;t receive the code?{" "}
					<button
						type="button"
						onClick={onResend}
						disabled={isResending}
						className="font-medium underline disabled:opacity-50"
					>
						{isResending ? "Sending…" : "Resend OTP"}
					</button>
				</p>
			</form>
		</Form>
	);
}
