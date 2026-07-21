"use client";

import { useState } from "react";
import { IoEye, IoEyeOff } from "react-icons/io5";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface InputProps {
	name: string;
	label?: string;
	type?: string;
	placeholder?: string;
	value: string | number | undefined;
	readonly?: boolean;
	error?: string | null;
	onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
	onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
	min?: number;
	max?: number;
	autoComplete?: string;
	disabled?: boolean;
	description?: string;
	className?: string;
}

const InputField: React.FC<InputProps> = ({
	placeholder,
	disabled,
	name,
	readonly,
	label,
	type = "text",
	value,
	onChange,
	onBlur,
	error,
	min,
	max,
	description,
	className = "",
}) => {
	const [view, setView] = useState(false);

	const handleView = () => {
		setView((prev) => !prev);
	};

	return (
		<div className="space-y-2">
			<Label htmlFor={name} className="text-sm font-light">
				{label}
			</Label>

			{description && (
				<p className="text-sm text-muted-foreground">{description}</p>
			)}

			<div className="relative">
				<Input
					id={name}
					name={name}
					type={type === "password" && view ? "text" : type}
					placeholder={placeholder}
					value={value}
					onChange={onChange}
					onBlur={onBlur}
					disabled={disabled}
					readOnly={readonly}
					min={min}
					max={max}
					className={`shadow-none outline-none focus:outline-0 focus:border-primary border-neutral-light-hover rounded-[900px] text-base placeholder:text-sm placeholder:text-neutral-light-active h-10.75 caret-primary md:h-12 sm:text-base sm:py-4 bg-white px-6 focus-visible:ring-1
            ${className}
            ${
							error ? "border-accent text-accent focus-visible:ring-accent" : ""
						}
            ${
							readonly
								? "bg-neutral-600 text-black font-semibold cursor-not-allowed"
								: ""
						}
          `}
				/>

				{type === "password" && (
					<button
						type="button"
						onClick={handleView}
						className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-xl transition-colors"
						tabIndex={-1}
					>
						{view ? <IoEyeOff /> : <IoEye />}
					</button>
				)}
			</div>

			{/* {error && <p className="text-xs text-red-600">{error}</p>} */}
		</div>
	);
};

export default InputField;
