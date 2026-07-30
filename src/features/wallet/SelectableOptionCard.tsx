import React from "react";
import { IoClose } from "react-icons/io5";

interface SelectableOptionCardProps {
	icon: React.ReactNode;
	iconBg?: string;
	label: string;
	sublabel: string;
	selected: boolean;
	onClick: () => void;
	onRemove?: () => void;
	disabled?: boolean;
}

export default function SelectableOptionCard({
	icon,
	iconBg = "bg-primary-light",
	label,
	sublabel,
	selected,
	onClick,
	onRemove,
	disabled,
}: SelectableOptionCardProps) {
	return (
		<div
			className={`flex items-center gap-2 rounded-[15px] border p-3.5 md:p-4 transition-colors ${
				selected
					? "border-primary bg-primary-light/40"
					: "border-neutral-light-hover hover:border-primary-light-active"
			}`}
		>
			<button
				type="button"
				onClick={onClick}
				disabled={disabled}
				className="flex items-center gap-3 flex-1 min-w-0 text-left cursor-pointer bg-transparent border-0 p-0 disabled:cursor-not-allowed disabled:opacity-50"
			>
				<div
					className={`w-9 h-9 md:w-10 md:h-10 rounded-full flex items-center justify-center shrink-0 ${iconBg} text-primary`}
				>
					{icon}
				</div>

				<div className="min-w-0 flex-1">
					<p className="text-xs md:text-sm font-medium text-neutral-dark truncate">
						{label}
					</p>
					<p className="text-[10px] md:text-xs font-light text-neutral-light-active truncate">
						{sublabel}
					</p>
				</div>

				<span
					className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
						selected ? "border-primary bg-primary" : "border-neutral-light-hover bg-white"
					}`}
				>
					{selected && (
						<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4">
							<polyline points="20 6 9 17 4 12" />
						</svg>
					)}
				</span>
			</button>

			{onRemove && (
				<button
					type="button"
					onClick={onRemove}
					disabled={disabled}
					className="text-neutral-light-active hover:text-error-500 cursor-pointer bg-transparent border-0 p-1 shrink-0 disabled:cursor-not-allowed"
				>
					<IoClose className="text-sm" />
				</button>
			)}
		</div>
	);
}
