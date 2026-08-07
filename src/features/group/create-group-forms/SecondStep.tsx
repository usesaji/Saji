/* eslint-disable react-hooks/incompatible-library */
/* eslint-disable @next/next/no-img-element */
"use client";
import React from "react";
import StepWizard from "./StepWizard";
import { Button } from "../../../components/ui/button";
import {
	Form,
	// FormControl,
	FormField,
	// FormItem,
	// FormMessage,
} from "../../../components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
	SecondStepInput,
	SecondStepSchema,
} from "../../../lib/validations/create-group/second-step";
import {
	PayoutOrder,
	useCreateGroupStore,
} from "../../../lib/store/create-group-store";
import { useRouter } from "next/navigation";
import { Label } from "../../../components/ui/label";

// Payout Order Icons
function PayoutIcon({ type, active }: { type: string; active: boolean }) {
	const color = active ? "#ffffff" : "#4100f5";
	switch (type) {
		case "random":
			return (
				<svg
					width="22"
					height="22"
					viewBox="0 0 24 24"
					fill="none"
					stroke={color}
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
					<line x1="16" y1="2" x2="16" y2="6" />
					<line x1="8" y1="2" x2="8" y2="6" />
					<line x1="3" y1="10" x2="21" y2="10" />
					<circle cx="8" cy="15" r="1.5" fill={color} />
					<circle cx="16" cy="15" r="1.5" fill={color} />
					<circle cx="12" cy="18" r="1.5" fill={color} />
				</svg>
			);
		case "manual":
			return (
				<svg
					width="22"
					height="22"
					viewBox="0 0 24 24"
					fill="none"
					stroke={color}
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
					<line x1="16" y1="2" x2="16" y2="6" />
					<line x1="8" y1="2" x2="8" y2="6" />
					<line x1="3" y1="10" x2="21" y2="10" />
					<path d="M12 14v4M10 16h4" />
				</svg>
			);
		case "vote":
			return (
				<svg
					width="22"
					height="22"
					viewBox="0 0 24 24"
					fill="none"
					stroke={color}
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
					<line x1="16" y1="2" x2="16" y2="6" />
					<line x1="8" y1="2" x2="8" y2="6" />
					<line x1="3" y1="10" x2="21" y2="10" />
					<path d="M8 16a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2" strokeWidth="2" />
					<path d="M9 13v-1M15 13v-1" strokeWidth="3" />
				</svg>
			);
		case "custom":
			return (
				<svg
					width="22"
					height="22"
					viewBox="0 0 24 24"
					fill="none"
					stroke={color}
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
					<line x1="16" y1="2" x2="16" y2="6" />
					<line x1="8" y1="2" x2="8" y2="6" />
					<line x1="3" y1="10" x2="21" y2="10" />
					<path d="M12 14l4 4M16 14l-4 4" />
				</svg>
			);
		default:
			return null;
	}
}

const SecondStep = () => {
	const store = useCreateGroupStore();
	const router = useRouter();

	const form = useForm<SecondStepInput>({
		resolver: zodResolver(SecondStepSchema),
		mode: "onChange",
		reValidateMode: "onChange",
		defaultValues: {
			grace_period: store.grace_period || "3",
			late_fee_percentage: store.late_fee_percentage || "5",
			payout_order: store.payout_order || "manual",
			auto_approval: store.auto_approval ?? false,
			contribute_privacy: store.contribute_privacy || "public",
		},
	});

	const {
		formState: { isValid, isSubmitting },
	} = form;

	const watchLateFeePercentage = form.watch("late_fee_percentage");

	const onSubmit = (values: SecondStepInput) => {
		store.updateData(values);
		store.nextStep();
	};

	// Calculate absolute late fee amount dynamically
	const targetAmount = Number(store.target_amount) || 0;
	const lateFeePercentage = Number(watchLateFeePercentage) || 0;
	const calculatedLateFee = (targetAmount * lateFeePercentage) / 100;

	return (
		<div>
			<StepWizard step={2} />

			<section className="mt-5">
				<h2 className="text-xl font-semibold text-neutral-dark">Group Rules</h2>
			</section>

			<section className="mt-4">
				<Form {...form}>
					<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
						{/* --------------------------------
							Utility Fees Section
						-------------------------------- */}
						<div>
							<p className="text-xs font-light text-neutral-light-active mb-2.5">
								Utility Fees
							</p>
							<div className="grid grid-cols-2 gap-4">
								{/* Late Fee Card (Interactive) */}
								<FormField
									control={form.control}
									name="late_fee_percentage"
									render={({ field, fieldState }) => (
										<div className="flex flex-col">
											<div className="bg-primary rounded-[20px] p-5 text-white flex flex-col justify-between h-35 relative overflow-hidden">
												<div>
													<p className="text-[10px] opacity-80 font-light">
														Late Fee
													</p>
													<div className="flex items-center gap-1.5 mt-2">
														{/* Coin SVG */}
														<svg
															width="24"
															height="24"
															viewBox="0 0 24 24"
															fill="none"
															xmlns="http://www.w3.org/2000/svg"
														>
															<circle
																cx="12"
																cy="12"
																r="10"
																stroke="white"
																strokeWidth="2"
															/>
															<circle
																cx="12"
																cy="12"
																r="7"
																stroke="white"
																strokeWidth="1"
																strokeDasharray="2 2"
															/>
															<text
																x="8.5"
																y="16"
																fill="white"
																fontSize="12"
																fontWeight="bold"
															>
																$
															</text>
														</svg>
														<span className="text-2xl font-bold">
															{calculatedLateFee.toFixed(2)}
														</span>
													</div>
												</div>

												{/* Rate Input inside Card */}
												<div className="flex items-center gap-1.5 mt-2 bg-white/20 rounded-full px-3 py-1.5 w-fit border border-white/10 z-10">
													<span className="text-[10px] opacity-90 font-light">
														Rate:
													</span>
													<input
														type="text"
														{...field}
														className="bg-transparent text-white font-semibold text-xs w-6 text-center outline-none border-b border-white/40 focus:border-white"
													/>
													<span className="text-[10px] opacity-90 font-light">
														%
													</span>
												</div>

												{/* Decorative Receipt SVG */}
												<div className="absolute right-0 bottom-8 sm:right-3 sm:bottom-8 pointer-events-none sm:scale-[1.6]">
													<img
														className="h-full w-full object-contain"
														src="/images/late_fee.svg"
														alt=""
													/>
												</div>
												{/* <div className="absolute right-2 bottom-2 pointer-events-none opacity-90">
													<svg
														width="45"
														height="45"
														viewBox="0 0 45 45"
														fill="none"
														xmlns="http://www.w3.org/2000/svg"
													>
														<path
															d="M5 38V5C5 3.89543 5.89543 3 7 3H31L40 12V38C40 39.1046 39.1046 40 38 40H7C5.89543 40 5 39.1046 5 38Z"
															fill="#FF0084"
														/>
														<path d="M31 3V12H40" fill="#FFE6F3" />
														<rect
															x="10"
															y="18"
															width="20"
															height="3"
															rx="1.5"
															fill="#FFE6F3"
														/>
														<rect
															x="10"
															y="25"
															width="15"
															height="3"
															rx="1.5"
															fill="#FFE6F3"
														/>
														<circle cx="32" cy="30" r="4" fill="#FFE6F3" />
													</svg>
												</div> */}
											</div>
											{fieldState.error && (
												<p className="text-[10px] text-error-500 mt-1 px-1">
													{fieldState.error.message}
												</p>
											)}
										</div>
									)}
								/>

								{/* Service Charge Card (Display Only) */}
								<div className="bg-primary-light rounded-[20px] p-5 flex flex-col justify-between h-35 relative overflow-hidden">
									<div>
										<p className="text-[10px] opacity-70 font-light">
											Service Charge
										</p>
										<span className="text-3xl sm:text-5xl font-bold block mt-2">
											{store.service_charge || 0}%
										</span>
										<div className="absolute right-0 -bottom-8  pointer-events-none scale[0.6] w-24">
											<img
												className="h-full w-full object-contain"
												src="/images/about/native-drum.svg"
												alt=""
											/>
										</div>
									</div>

									{/* Decorative Honey Jar SVG */}
									{/* <div className="absolute right-2 bottom-2 pointer-events-none">
										<svg
											width="55"
											height="55"
											viewBox="0 0 60 60"
											fill="none"
											xmlns="http://www.w3.org/2000/svg"
										>
											<path
												d="M18 16C18 14.8954 18.8954 14 20 14H40C41.1046 14 42 14.8954 42 16V19H18V16Z"
												fill="#D97706"
											/>
											<rect
												x="15"
												y="19"
												width="30"
												height="4"
												rx="2"
												fill="#F59E0B"
											/>
											<path
												d="M18 23H42V48C42 51.3137 39.3137 54 36 54H24C20.6863 54 18 51.3137 18 48V23Z"
												fill="#FBBF24"
												opacity="0.95"
											/>
											<rect
												x="23"
												y="32"
												width="14"
												height="9"
												rx="1.5"
												fill="#FFFBEB"
											/>
											<path
												d="M25 36.5H35"
												stroke="#D97706"
												strokeWidth="1.5"
												strokeLinecap="round"
											/>
											<path
												d="M18 23C21 26 25 24 28 27C31 30 35 28 38 30C41 32 42 29 42 23V30C42 30 38 32 34 29C30 26 26 30 22 27C18 24 18 23 18 23Z"
												fill="#F59E0B"
											/>
										</svg>
									</div> */}
								</div>
							</div>
						</div>

						{/* --------------------------------
							Grace Period Section
						-------------------------------- */}
						<FormField
							control={form.control}
							name="grace_period"
							render={({ field, fieldState }) => (
								<div>
									<Label className="text-sm font-light mb-2.5">
										Grace Period (Days)
									</Label>
									<div className="flex items-center justify-between bg-neutral-comment rounded-[15px] px-6 py-3 h-12">
										<button
											type="button"
											onClick={() => {
												const current = Number(field.value) || 0;
												if (current > 0) {
													form.setValue("grace_period", String(current - 1), {
														shouldValidate: true,
														shouldDirty: true,
														shouldTouch: true,
													});
												}
											}}
											className="text-2xl font-light text-neutral-dark select-none w-10 h-10 flex items-center justify-center cursor-pointer hover:opacity-70 transition-opacity"
										>
											—
										</button>
										<span className="text-base font-light text-neutral-dark">
											{field.value || "0"} days
										</span>
										<button
											type="button"
											onClick={() => {
												const current = Number(field.value) || 0;
												form.setValue("grace_period", String(current + 1), {
													shouldValidate: true,
													shouldDirty: true,
													shouldTouch: true,
												});
											}}
											className="text-2xl font-light text-neutral-dark select-none w-10 h-10 flex items-center justify-center cursor-pointer hover:opacity-70 transition-opacity"
										>
											+
										</button>
									</div>
									{fieldState.error && (
										<p className="text-xs text-error-500 mt-1 px-1">
											{fieldState.error.message}
										</p>
									)}
								</div>
							)}
						/>

						{/* --------------------------------
							Payout Order Section
						-------------------------------- */}
						<FormField
							control={form.control}
							name="payout_order"
							render={({ fieldState }) => (
								<div>
									<Label className="text-sm font-light mb-2.5">
										Payout Order
									</Label>
									<div className="flex items-center justify-between px-2">
										{(
											[
												{ value: "random", label: "Random" },
												{ value: "manual", label: "Manual" },
												{ value: "vote", label: "Vote" },
												{ value: "custom", label: "Custom" },
											] satisfies { value: PayoutOrder; label: string }[]
										).map((option) => {
											const active =
												form.watch("payout_order") === option.value;
											return (
												<button
													key={option.value}
													type="button"
													onClick={() =>
														form.setValue("payout_order", option.value, {
															shouldValidate: true,
															shouldDirty: true,
															shouldTouch: true,
														})
													}
													className="flex flex-col items-center cursor-pointer"
												>
													<div
														className={`rounded-full h-14.5 w-14.5 flex items-center justify-center transition-colors ${
															active ? "bg-primary" : "bg-primary-light"
														}`}
													>
														<PayoutIcon type={option.value} active={active} />
													</div>
													<span
														className={`text-xs mt-2 transition-colors ${
															active ? "font-medium text-primary" : "font-light"
														}`}
													>
														{option.label}
													</span>
												</button>
											);
										})}
									</div>
									{fieldState.error && (
										<p className="text-xs text-error-500 mt-2 px-1">
											{fieldState.error.message}
										</p>
									)}
								</div>
							)}
						/>

						{/* --------------------------------
							Auto Approval Toggle
						-------------------------------- */}
						<FormField
							control={form.control}
							name="auto_approval"
							render={({ field }) => (
								<div className="flex items-center justify-between pt-2">
									<div>
										<p className="text-sm font-normal text-neutral-dark">
											Auto Approval
										</p>
										<p className="text-[10px] font-light text-neutral-light-active mt-0.5">
											Automatically approve join request
										</p>
									</div>
									<button
										type="button"
										role="switch"
										aria-checked={field.value}
										onClick={() => field.onChange(!field.value)}
										className={`relative inline-flex min-h-6 w-11 shrink-0 px-0.2 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
											field.value ? "bg-primary" : "bg-neutral-light-hover"
										}`}
									>
										<span
											className={`pointer-events-none inline-block h-5 w-5 transform rounded-full shadow transition duration-200 ease-in-out ${
												field.value
													? "translate-x-5 bg-white"
													: "translate-x-0 bg-neutral-hover"
											}`}
										/>
									</button>
								</div>
							)}
						/>

						{/* --------------------------------
							Contribute Privacy Toggle
						-------------------------------- */}
						<FormField
							control={form.control}
							name="contribute_privacy"
							render={({ field }) => (
								<div className="flex items-center justify-between pt-1">
									<div>
										<p className="text-sm font-normal text-neutral-dark">
											Contribute Privacy
										</p>
										<p className="text-[10px] font-light text-neutral-light-active mt-0.5">
											Hide member balances from each other
										</p>
									</div>
									<button
										type="button"
										role="switch"
										aria-checked={field.value === "private"}
										onClick={() =>
											field.onChange(
												field.value === "public" ? "private" : "public",
											)
										}
										className={`relative inline-flex min-h-6 px-0.2 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
											field.value === "private"
												? "bg-primary"
												: "bg-neutral-light-hover"
										}`}
									>
										<span
											className={`pointer-events-none inline-block h-5 w-5 transform rounded-full shadow transition duration-200 ease-in-out ${
												field.value === "private"
													? "translate-x-5 bg-white"
													: "translate-x-0 bg-neutral-hover"
											}`}
										/>
									</button>
								</div>
							)}
						/>

						{/* --------------------------------
							Banner Illustration
						-------------------------------- */}
						<div className="bg-primary rounded-[20px] p-5.5 text-white flex items-center justify-between mt-10 relative overflow-hidden min-h-41.75">
							<div className="max-w-[65%] z-10">
								<h3 className="text-base">Trust Built on Rules</h3>
								<p className="text-sm font-light opacity-90 mt-1.5 leading-normal w-2/3">
									Clear rules reduce friction and ensure everyone grows together
									in your community
								</p>
							</div>

							{/* Overlapping Illustration circles */}
							<div className="absolute right-4 bottom-0 w32 z-0 h-36">
								<img
									className="h-full w-full object-contain"
									src="/images/trust_rules.svg"
									alt=""
								/>
							</div>
						</div>

						{/* --------------------------------
							Actions Bottom Buttons
						-------------------------------- */}
						<div className="flex gap-4 pt-4">
							<Button
								type="button"
								onClick={() => {
									store.reset();
									router.push("/groups");
								}}
								className="flex-1 bg-neutral-comment text-[#FF0000] rounded-full h-12 transition-colors hover:bg-neutral-light border-0 cursor-pointer shadow-none"
							>
								Discard Draft
							</Button>
							<Button
								type="submit"
								disabled={!isValid || isSubmitting}
								variant="dark"
								className="flex-1"
							>
								Save & Continue
							</Button>
						</div>
					</form>
				</Form>
			</section>
		</div>
	);
};

export default SecondStep;
