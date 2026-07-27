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
import { useState } from "react";
import { useRouter } from "next/navigation";

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

	const onSubmit = (values: CreateProfileValues) => {
		console.log(values);
		setIsLoading(true);

		setTimeout(() => {
			toast.success("", "Profile Created");
			setIsLoading(false);
			router.push(pageRoutes.dashboardRoutes.OVERVIEW);
		}, 2000);
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
