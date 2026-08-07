"use client";

import { Button } from "../../../components/ui/button";
import InputField from "../../../components/ui/custom/InputField";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormMessage,
} from "../../../components/ui/form";
import { SignInSchema } from "../../../lib/validations/authValidations";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import GoogleAuthBtn from "./GoogleAuthBtn";
import Link from "next/link";
import { pageRoutes } from "../../../config/routes";
import { toast } from "../../../lib/utils/toast";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiError, auth, fieldErrors, setToken } from "../../../lib/api";

type SignInValues = z.infer<typeof SignInSchema>;

/**
 * Flags set by `src/app/api/auth/google/*`. An unmapped code shows no toast at
 * all, so every `?error=` the callback can emit needs an entry here.
 */
const GOOGLE_ERRORS: Record<string, string> = {
	google: "Google sign-in was cancelled or failed. Please try again.",
	google_no_email: "Google didn't share a verified email for that account.",
	google_state: "That sign-in link expired. Please try again.",
	google_not_configured: "Google sign-in isn't set up on this server yet.",
};

export default function LoginForm() {
	const [isLoading, setIsLoading] = useState(false);
	const router = useRouter();
	const searchParams = useSearchParams();

	// Surface a failed Google redirect (?error=google) as a toast.
	useEffect(() => {
		const error = searchParams.get("error");
		if (error && GOOGLE_ERRORS[error]) {
			toast.error(GOOGLE_ERRORS[error], "Sign-in Failed");
		}
	}, [searchParams]);

	const form = useForm<SignInValues>({
		resolver: zodResolver(SignInSchema),
		mode: "onChange",
		reValidateMode: "onChange",
		defaultValues: {
			email: "",
			password: "",
		},
	});

	const {
		formState: { isValid, isSubmitting },
	} = form;

	const onSubmit = async (values: SignInValues) => {
		setIsLoading(true);

		try {
			const { token } = await auth.login({
				email: values.email,
				password: values.password,
			});

			setToken(token);
			toast.success("", "Login Successful");
			router.push(pageRoutes.dashboardRoutes.OVERVIEW);
		} catch (err) {
			// Laravel returns the credential failure keyed on `email`; surface it
			// on the field so the user sees it in context, not just as a toast.
			const fields = fieldErrors(err);
			for (const [name, message] of Object.entries(fields)) {
				if (name === "email" || name === "password") {
					form.setError(name, { message });
				}
			}

			toast.error(
				err instanceof ApiError ? err.message : "Something went wrong.",
				"Login Failed",
			);
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<div className="">
			<div className="mb-7 text-center lg:text-start">
				<h2 className="text-[30px] ">Welcome Back</h2>
				<p className="text-sm">Enter your credentials to sign in</p>
			</div>

			<Form {...form}>
				<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5 my-5">
					{/* --------------------------------
              EMAIL FIELD
			  -------------------------------- */}
					<FormField
						control={form.control}
						name="email"
						render={({ field, fieldState }) => (
							<FormItem>
								{/* <FormLabel>Email</FormLabel> */}

								<FormControl>
									<InputField
										{...field}
										label="Email"
										placeholder="Email address"
										type="email"
										error={fieldState.error?.message ?? null}
									/>
								</FormControl>

								<FormMessage />
							</FormItem>
						)}
					/>
					{/* --------------------------------
              PASSWORD
          -------------------------------- */}
					<FormField
						control={form.control}
						name="password"
						render={({ field, fieldState }) => (
							<FormItem>
								{/* <FormLabel>Email</FormLabel> */}

								<FormControl>
									<InputField
										{...field}
										label="Password"
										placeholder="password"
										type="password"
										error={fieldState.error?.message ?? null}
									/>
								</FormControl>

								<FormMessage />
							</FormItem>
						)}
					/>

					<Button
						type="submit"
						isLoading={isLoading}
						disabled={!isValid || isSubmitting}
						className="w-full"
					>
						Continue
					</Button>
				</form>
			</Form>

			<GoogleAuthBtn />

			<p className="font-light mt-6 text-center text-sm">
				Don&apos;t have an account?{" "}
				<Link className="font-medium" href={pageRoutes.authRoutes.REGISTER}>
					Sign Up
				</Link>
			</p>
		</div>
	);
}
