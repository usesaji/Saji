import React from "react";
import { HiOutlinePencil, HiOutlinePlus } from "react-icons/hi2";

interface PersonalInfoRowProps {
	label: string;
	value: string | null;
	onEdit: () => void;
}

export default function PersonalInfoRow({ label, value, onEdit }: PersonalInfoRowProps) {
	const isSet = Boolean(value);

	return (
		<div className="flex items-center justify-between gap-4 py-3.5">
			<div className="min-w-0">
				<p className="text-[11px] font-light text-neutral-light-active">{label}</p>
				<p
					className={`text-sm md:text-base mt-0.5 truncate ${
						isSet ? "text-neutral-dark font-medium" : "text-neutral-light-active"
					}`}
				>
					{value || "Not Set"}
				</p>
			</div>
			<button
				type="button"
				onClick={onEdit}
				className="flex items-center gap-1 text-primary hover:text-primary-hover text-sm font-medium shrink-0 cursor-pointer bg-transparent border-0"
			>
				{isSet ? (
					<>
						Edit
						<HiOutlinePencil className="text-xs" />
					</>
				) : (
					<>
						Add
						<HiOutlinePlus className="text-xs" />
					</>
				)}
			</button>
		</div>
	);
}
