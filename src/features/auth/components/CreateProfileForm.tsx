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
import { CreateProfileSchema } from "../../../lib/validations/authValidations";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { pageRoutes } from "../../../config/routes";
import { toast } from "../../../lib/utils/toast";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, auth, fieldErrors, setToken } from "../../../lib/api";
import { signupSession } from "../../../lib/auth/signup-session";

type CreateProfileValues = z.infer<typeof CreateProfileSchema>;

export default function CreateProfileForm() {
	const [isLoading, setIsLoading] = useState(false);
	const router = useRouter();

	const form = useForm<CreateProfileValues>({
		resolver: zodResolver(CreateProfileSchema),
		mode: "onChange",
		reValidateMode: "onChange",
		defaultValues: {
			full_name: "",
			password: "",
			confirmPassword: "",
			tag_name: "",
		},
	});

	const {
		formState: { isValid, isSubmitting },
	} = form;

	// Reaching this page without a verified email means the OTP step was skipped
	// or the token expired; send them back rather than failing on submit.
	useEffect(() => {
		if (!signupSession.getToken()) {
			toast.error("Verify your email first.", "Verification Required");
			router.replace(pageRoutes.authRoutes.REGISTER);
		}
	}, [router]);

	const onSubmit = async (values: CreateProfileValues) => {
		const signupToken = signupSession.getToken();

		if (!signupToken) {
			toast.error("Verify your email first.", "Verification Required");
			router.replace(pageRoutes.authRoutes.REGISTER);
			return;
		}

		setIsLoading(true);

		try {
			const { token } = await auth.completeProfile({
				signup_token: signupToken,
				name: values.full_name,
				tag_name: values.tag_name,
				password: values.password,
				password_confirmation: values.confirmPassword,
			});

			// Account created — log in and drop the signup scratch state.
			setToken(token);
			signupSession.clear();

			toast.success("", "Profile Created");
			router.push(pageRoutes.dashboardRoutes.OVERVIEW);
		} catch (err) {
			const fields = fieldErrors(err);

			if (fields.tag_name) {
				form.setError("tag_name", { message: fields.tag_name });
			}
			if (fields.name) {
				form.setError("full_name", { message: fields.name });
			}
			if (fields.password) {
				form.setError("password", { message: fields.password });
			}

			// An expired signup token can only be fixed by verifying again.
			if (fields.signup_token) {
				signupSession.clear();
				toast.error(fields.signup_token, "Verification Expired");
				router.replace(pageRoutes.authRoutes.REGISTER);
				return;
			}

			toast.error(
				err instanceof ApiError ? err.message : "Something went wrong.",
				"Could not create profile",
			);
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<div className="pt-6">
			<div className="mb-5 lg:text-center">
				<h2 className="text-[20px] lg:text-[30px]">Create Profile</h2>
				{/* <p className="text-sm">Enter your email to sign up</p> */}
			</div>

			<Form {...form}>
				<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5 my-5">
					{/* --------------------------------
              Name FIELD
          -------------------------------- */}
					<FormField
						control={form.control}
						name="full_name"
						render={({ field, fieldState }) => (
							<FormItem>
								{/* <FormLabel>Email</FormLabel> */}

								<FormControl>
									<InputField
										{...field}
										label="Full Name"
										placeholder="John Doe"
										type="text"
										error={fieldState.error?.message ?? null}
									/>
								</FormControl>

								<FormMessage />
							</FormItem>
						)}
					/>
					{/* --------------------------------
              Password FIELD
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
										placeholder="Create Password"
										type="password"
										error={fieldState.error?.message ?? null}
									/>
								</FormControl>

								<FormMessage />
							</FormItem>
						)}
					/>
					{/* --------------------------------
              Confirm password FIELD
          -------------------------------- */}
					<FormField
						control={form.control}
						name="confirmPassword"
						render={({ field, fieldState }) => (
							<FormItem>
								{/* <FormLabel>Email</FormLabel> */}

								<FormControl>
									<InputField
										{...field}
										label="Confirm Password"
										placeholder="Confirm Password"
										type="password"
										error={fieldState.error?.message ?? null}
									/>
								</FormControl>

								<FormMessage />
							</FormItem>
						)}
					/>
					{/* --------------------------------
              Name Tag FIELD
          -------------------------------- */}
					<FormField
						control={form.control}
						name="tag_name"
						render={({ field, fieldState }) => (
							<FormItem>
								{/* <FormLabel>Email</FormLabel> */}

								<FormControl>
									<InputField
										{...field}
										label="Tag Name"
										placeholder="@______"
										type="text"
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
						className="w-full mt-5"
					>
						Continue
					</Button>
				</form>
			</Form>
		</div>
	);
}
