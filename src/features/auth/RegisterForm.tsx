import { Button } from "../../components/ui/button";
import InputField from "../../components/ui/custom/InputField";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormMessage,
} from "../../components/ui/form";
import { SignUpSchema } from "../../lib/validations/authValidations";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import GoogleAuthBtn from "./GoogleAuthBtn";
import Link from "next/link";
import { pageRoutes } from "../../config/routes";
import { toast } from "../../lib/utils/toast";
import { useState } from "react";
import { useRouter } from "next/navigation";

type SignUpValues = z.infer<typeof SignUpSchema>;

export default function RegisterForm() {
	const [isLoading, setIsLoading] = useState(false);
	const router = useRouter();

	const form = useForm<SignUpValues>({
		resolver: zodResolver(SignUpSchema),
		mode: "onChange",
		reValidateMode: "onChange",
		defaultValues: {
			email: "",
		},
	});

	const {
		formState: { isValid, isSubmitting },
	} = form;

	const onSubmit = (values: SignUpValues) => {
		console.log(values);
		setIsLoading(true);

		setTimeout(() => {
			toast.success("Check your email to verify OTP", "OTP Sent");
			setIsLoading(false);
			router.push(pageRoutes.authRoutes.OTP);
		}, 2000);
	};

	return (
		<div className="">
			<div className="mb-7 text-center lg:text-start">
				<h2 className="text-[30px] ">Get Started</h2>
				<p className="text-sm">Enter your email to sign up</p>
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
				Already have an Account?{" "}
				<Link className="font-medium" href={pageRoutes.authRoutes.LOGIN}>
					Sign In
				</Link>
			</p>
		</div>
	);
}
