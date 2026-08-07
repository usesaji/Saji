"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import GoBack from "../../components/dashboard/GoBack";
import { Button } from "../../components/ui/button";
import InputField from "../../components/ui/custom/InputField";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "../../components/ui/select";
import { pageRoutes } from "../../config/routes";
import TransactionSuccessScreen from "../wallet/TransactionSuccessScreen";

const FILE_TYPES = [
	{ value: "pdf", label: "PDF" },
	{ value: "csv", label: "CSV" },
	{ value: "xlsx", label: "XLSX" },
];

type Status = "idle" | "loading" | "success";

export default function GenerateStatementView() {
	const router = useRouter();

	const [fileType, setFileType] = useState<string | null>(null);
	const [startDate, setStartDate] = useState("");
	const [endDate, setEndDate] = useState("");
	const [status, setStatus] = useState<Status>("idle");

	const canGenerate = fileType !== null && startDate !== "" && endDate !== "";

	const handleGenerate = () => {
		if (!canGenerate) return;
		setStatus("loading");
		setTimeout(() => setStatus("success"), 1200);
	};

	const handleBackToHome = () => {
		router.push(pageRoutes.dashboardRoutes.OVERVIEW);
	};

	if (status === "success") {
		return (
			<TransactionSuccessScreen
				heading="Statement is on its way!"
				description="Your statement is being generated and will be sent to your registered email shortly."
				buttonLabel="Back to home"
				onButtonClick={handleBackToHome}
			/>
		);
	}

	const isLoading = status === "loading";

	return (
		<div className="mx-auto md:max-w-xl lg:max-w-2xl w-full px-0 sm:px-4 py-2">
			<div className="space-y-6">
				<GoBack />

				<h2 className="text-xl font-semibold text-neutral-dark">Generate Statement</h2>

				<div className="space-y-2">
					<p className="text-sm font-light text-neutral-dark">File Type</p>
					<Select value={fileType} onValueChange={setFileType}>
						<SelectTrigger
							className="w-full h-10.75 md:h-12 rounded-[900px] border-neutral-light-hover px-6 justify-between"
							disabled={isLoading}
						>
							<SelectValue placeholder="Select file format" />
						</SelectTrigger>
						<SelectContent className="w-full min-w-70">
							<SelectGroup>
								{FILE_TYPES.map((type) => (
									<SelectItem key={type.value} value={type.value}>
										{type.label}
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
				</div>

				<InputField
					name="startDate"
					label="Start Date"
					type="date"
					value={startDate}
					onChange={(e) => setStartDate(e.target.value)}
					disabled={isLoading}
				/>

				<InputField
					name="endDate"
					label="End Date"
					type="date"
					value={endDate}
					onChange={(e) => setEndDate(e.target.value)}
					disabled={isLoading}
				/>

				<Button
					type="button"
					onClick={handleGenerate}
					disabled={!canGenerate}
					isLoading={isLoading}
					className="w-full"
				>
					Generate Statement
				</Button>
			</div>
		</div>
	);
}
