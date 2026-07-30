import React from "react";

interface AmountInputProps {
	label: string;
	value: string;
	onChange: (value: string) => void;
	quickAmounts?: number[];
	maxAmount?: number;
	error?: string | null;
	disabled?: boolean;
}

const AMOUNT_REGEX = /^\d*\.?\d{0,2}$/;

const formatAmount = (value: number) =>
	value.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function AmountInput({
	label,
	value,
	onChange,
	quickAmounts = [15000, 25000, 55000],
	maxAmount,
	error,
	disabled,
}: AmountInputProps) {
	const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const raw = e.target.value;
		if (raw === "" || AMOUNT_REGEX.test(raw)) {
			onChange(raw);
		}
	};

	return (
		<div>
			<label className="text-xs font-light text-neutral-light-active block mb-2.5">
				{label}
			</label>

			<div
				className={`flex items-center gap-2 rounded-full border-2 px-6 h-14 md:h-16 transition-colors ${
					error
						? "border-error-400"
						: "border-neutral-light-hover focus-within:border-primary"
				} ${disabled ? "opacity-60" : ""}`}
			>
				<span
					className={`text-lg md:text-xl font-medium ${error ? "text-error-400" : "text-primary"}`}
				>
					₦
				</span>
				<input
					type="text"
					inputMode="decimal"
					value={value}
					onChange={handleChange}
					disabled={disabled}
					placeholder="150,000.00"
					className={`w-full bg-transparent outline-none text-lg md:text-xl font-medium placeholder:text-neutral-light-active placeholder:font-normal ${
						error ? "text-error-400" : "text-neutral-dark"
					}`}
				/>
			</div>

			{error && <p className="text-xs text-error-500 mt-1.5 px-1">{error}</p>}

			<div className="flex items-center gap-2 mt-3.5 overflow-x-auto hide-scroll">
				{quickAmounts.map((amount) => {
					const active = value === String(amount);
					return (
						<button
							key={amount}
							type="button"
							disabled={disabled}
							onClick={() => onChange(String(amount))}
							className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-medium cursor-pointer border-0 transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
								active
									? "bg-neutral-dark text-white"
									: "bg-primary-light text-primary hover:bg-primary-light-hover"
							}`}
						>
							₦{amount.toLocaleString()}
						</button>
					);
				})}

				{maxAmount !== undefined && (
					<button
						type="button"
						disabled={disabled}
						onClick={() => onChange(String(maxAmount))}
						className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-medium cursor-pointer border-0 transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
							value === String(maxAmount)
								? "bg-neutral-dark text-white"
								: "bg-primary-light text-primary hover:bg-primary-light-hover"
						}`}
					>
						Max
					</button>
				)}
			</div>
		</div>
	);
}

export { formatAmount };
