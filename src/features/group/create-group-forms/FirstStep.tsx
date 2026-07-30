/* eslint-disable @next/next/no-img-element */
"use client";
import React, { useEffect, useRef, useState } from "react";
import StepWizard from "./StepWizard";
import { Button } from "../../../components/ui/button";
import { FiPlus } from "react-icons/fi";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "../../../components/ui/form";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import InputField from "../../../components/ui/custom/InputField";
import {
	FirstStepInput,
	FirstStepSchema,
} from "../../../lib/validations/create-group/first-step";
import { useCreateGroupStore } from "../../../lib/store/create-group-store";

// Single reusable icon — color is driven by `active` instead of being
// hardcoded per option, so every frequency option shares one definition.
function CalendarIcon({ active }: { active: boolean }) {
	return (
		<svg
			width="20"
			height="23"
			viewBox="0 0 20 23"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				d="M19.8506 18.4727C19.8505 20.9089 17.8757 22.8838 15.4395 22.8838H4.41113C1.97494 22.8837 4.59883e-05 20.9089 0 18.4727V9.37402H19.8506V18.4727ZM14.3369 0C14.7936 2.0236e-05 15.1639 0.370453 15.1641 0.827148V2.48145H15.4395C17.8756 2.48145 19.8504 4.45644 19.8506 6.89258V7.71973H0V6.89258C0.000212104 4.45651 1.97505 2.48156 4.41113 2.48145H4.6875V0.827148C4.68762 0.370441 5.05791 0 5.51465 0C5.97117 0.000249388 6.34168 0.370595 6.3418 0.827148V2.48145H13.5098V0.827148C13.5099 0.370441 13.8802 0 14.3369 0Z"
				fill={active ? "#fff" : "#4100F4"}
			/>
		</svg>
	);
}

// NOTE: make sure these values match the enum in CreateGroupValidation.ts —
// e.g. contribution_frequency: z.enum(["daily", "weekly", "biweekly", "monthly"])
const frequencyOptions = [
	{ value: "daily", label: "Daily" },
	{ value: "weekly", label: "Weekly" },
	{ value: "biweekly", label: "Bi Weekly" },
	{ value: "monthly", label: "Monthly" },
] as const;

const FirstStep = () => {
	const [preview, setPreview] = useState<string | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const store = useCreateGroupStore();

	const form = useForm<FirstStepInput>({
		resolver: zodResolver(FirstStepSchema),
		mode: "onChange",
		reValidateMode: "onChange",
		defaultValues: {
			group_photo: store.group_photo,
			group_name: store.group_name,
			target_amount: store.target_amount,
			service_charge: store.service_charge,
			contribution_frequency: store.contribution_frequency,
		},
	});

	const {
		formState: { isValid, isSubmitting },
	} = form;

	const selectedFrequency = useWatch({
		control: form.control,
		name: "contribution_frequency",
	});

	useEffect(() => {
		if (!preview) return;

		return () => URL.revokeObjectURL(preview);
	}, [preview]);

	const onSubmit = (values: FirstStepInput) => {
		store.updateData(values);
		store.nextStep();

		console.log(values)
	};

	return (
		<div>
			<StepWizard step={1} />

			<section>
				<Form {...form}>
					<form
						onSubmit={form.handleSubmit(onSubmit)}
						className="space-y-5 my-5"
					>
						{/* Image */}

						<FormField
							control={form.control}
							name="group_photo"
							render={() => (
								<FormItem>
									<FormControl>
										<div>
											<input
												ref={fileInputRef}
												type="file"
												accept="image/*"
												className="hidden"
												onChange={(e) => {
													const file = e.target.files?.[0];
													if (!file) return;

													if (preview) {
														URL.revokeObjectURL(preview);
													}

													const url = URL.createObjectURL(file);

													setPreview(url);

													form.setValue("group_photo", file, {
														shouldValidate: true,
														shouldDirty: true,
													});
												}}
												// onChange={(e) => {

												// 	const file = e.target.files?.[0];

												// 	if (!file) return;

												// 	form.setValue("group_photo", file, {
												// 		shouldDirty: true,
												// 		shouldTouch: true,
												// 		shouldValidate: true,
												// 	});

												// 	setPreview(URL.createObjectURL(file));
												// }}
											/>

											<div
												onClick={() => fileInputRef.current?.click()}
												className="cursor-pointer text-white rounded-[10px] px-3 pb-5 pt-3"
												style={{
													backgroundImage: preview
														? `url(${preview})`
														: "url(/images/photo-label.svg)",
													backgroundPosition: "center",
													backgroundRepeat: "no-repeat",
													backgroundSize: preview ? "cover" : "cover",
												}}
											>
												<p className="text-[10px]">
													{preview ? "Change Group Photo" : "Set Group Photo"}
												</p>

												<div className="flex justify-center mt-5">
													{!preview ? (
														<>
															<div className="flex items-center justify-center">
																<svg
																	width="28"
																	height="28"
																	viewBox="0 0 28 28"
																	fill="none"
																	xmlns="http://www.w3.org/2000/svg"
																>
																	<path
																		d="M16.2236 0C16.7505 0.000181064 17.1777 0.427162 17.1777 0.954102C17.1776 1.48091 16.7504 1.90802 16.2236 1.9082H6.04395C3.76007 1.90822 1.9082 3.76006 1.9082 6.04395V16.8584L3.41992 17.8662C6.42542 19.8698 10.4272 19.4739 12.9814 16.9199L14.375 15.5264C16.9293 12.9721 20.9319 12.5754 23.9375 14.5791L24.7158 15.0986C24.9897 15.2813 25.2349 15.4967 25.4482 15.7373V11.1338C25.4482 10.6068 25.8754 10.1789 26.4023 10.1787C26.9294 10.1787 27.3574 10.6067 27.3574 11.1338V21.3125C27.3573 24.6504 24.6504 27.3564 21.3125 27.3564H6.04395C2.70605 27.3564 0.000131942 24.6504 0 21.3125V6.04395C0 2.70596 2.70596 1.53505e-05 6.04395 0H16.2236ZM24.9443 23.291C24.4805 23.9255 23.92 24.484 23.2852 24.9473C23.985 24.5667 24.5626 23.9902 24.9443 23.291ZM2.41211 23.291C2.79308 23.9889 3.36933 24.5647 4.06738 24.9453C3.43398 24.4825 2.8751 23.9243 2.41211 23.291ZM9.22461 6.04395C10.9814 6.04395 12.4062 7.46784 12.4062 9.22461C12.4062 10.9814 10.9814 12.4062 9.22461 12.4062C7.46796 12.406 6.04395 10.9813 6.04395 9.22461C6.04403 7.46798 7.46801 6.04416 9.22461 6.04395ZM21.0107 1.17871C21.8803 0.309222 23.2906 0.309173 24.1602 1.17871L25.8047 2.82422C26.1774 3.1969 26.1774 3.80115 25.8047 4.17383C25.432 4.54629 24.8277 4.54644 24.4551 4.17383L23.54 3.25781V8.58887C23.5399 9.11578 23.1119 9.54297 22.585 9.54297C22.0582 9.54274 21.631 9.11564 21.6309 8.58887V3.25781L20.7158 4.17383C20.3432 4.54641 19.7389 4.54621 19.3662 4.17383C18.9935 3.80115 18.9935 3.1969 19.3662 2.82422L21.0107 1.17871Z"
																		fill="#ECE6FE"
																	/>
																</svg>
															</div>
														</>
													) : (
														<div className="w-28 h-28 rounded-full overflow-hidden border-4 border-white">
															<img
																src={preview}
																alt="Preview"
																className="w-full h-full object-cover"
															/>
														</div>
													)}
												</div>

												<div className="flex justify-center mt-4">
													<Button
														type="button"
														className="bg-primary-dark py-1"
													>
														<span className="text-xs">
															{preview ? "Change Photo" : "Browse Photos"}
														</span>
														<FiPlus />
													</Button>
												</div>
											</div>
										</div>
									</FormControl>

									<FormMessage />
								</FormItem>
							)}
						/>

						{/* --------------------------------
              Group name
          -------------------------------- */}
						<FormField
							control={form.control}
							name="group_name"
							render={({ field, fieldState }) => (
								<FormItem>
									<FormControl>
										<InputField
											{...field}
											label="Group Name"
											placeholder="Summer Fund"
											type="text"
											error={fieldState.error?.message ?? null}
										/>
									</FormControl>

									<FormMessage />
								</FormItem>
							)}
						/>
						{/* --------------------------------
              Target Amount
          -------------------------------- */}
						<FormField
							control={form.control}
							name="target_amount"
							render={({ field, fieldState }) => (
								<FormItem>
									<FormControl>
										<InputField
											{...field}
											label="Target Amount"
											placeholder="$150,000.00"
											type="text"
											error={fieldState.error?.message ?? null}
										/>
									</FormControl>

									<FormMessage />
								</FormItem>
							)}
						/>
						{/* --------------------------------
              Service Charge
          -------------------------------- */}
						<FormField
							control={form.control}
							name="service_charge"
							render={({ field, fieldState }) => (
								<FormItem>
									<FormControl>
										<InputField
											{...field}
											label="Service Charge (%)"
											placeholder="30"
											type="text"
											error={fieldState.error?.message ?? null}
										/>
									</FormControl>

									<FormMessage />
								</FormItem>
							)}
						/>

						{/* --------------------------------
              Contribution Frequency
          -------------------------------- */}
						<FormField
							control={form.control}
							name="contribution_frequency"
							render={({ fieldState }) => (
								<FormItem>
									<FormLabel className="font-light">
										Contribution Frequency
									</FormLabel>

									<div
										role="radiogroup"
										aria-label="Contribution Frequency"
										className="flex items-center justify-between"
									>
										{frequencyOptions.map((option) => {
											const active = selectedFrequency === option.value;

											return (
												<button
													key={option.value}
													type="button"
													role="radio"
													aria-checked={active}
													onClick={() =>
														form.setValue(
															"contribution_frequency",
															option.value,
															{
																shouldValidate: true,
																shouldDirty: true,
																shouldTouch: true,
															},
														)
													}
													className="flex flex-col items-center mt-3.5"
												>
													<div
														className={`rounded-full h-14.5 w-14.5 flex items-center justify-center transition-colors ${
															active ? "bg-primary" : "bg-primary-light"
														}`}
													>
														<CalendarIcon active={active} />
													</div>
													<p
														className={`text-xs mt-1.5 transition-colors ${
															active ? "font-medium text-primary" : "font-light"
														}`}
													>
														{option.label}
													</p>
												</button>
											);
										})}
									</div>

									{fieldState.error && (
										<p className="text-xs text-error-500 mt-1">
											{fieldState.error.message}
										</p>
									)}
								</FormItem>
							)}
						/>

						<Button
							type="submit"
							disabled={!isValid || isSubmitting}
							className="w-full mt-5"
						>
							Continue
						</Button>
					</form>
				</Form>
			</section>
		</div>
	);
};

export default FirstStep;
