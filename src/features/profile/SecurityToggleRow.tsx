import React from "react";
import { Switch } from "../../components/ui/switch";

interface SecurityToggleRowProps {
	label: string;
	description: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
}

export default function SecurityToggleRow({
	label,
	description,
	checked,
	onChange,
}: SecurityToggleRowProps) {
	return (
		<div className="flex items-center justify-between gap-4 py-4 border-b border-neutral-light last:border-b-0">
			<div className="min-w-0">
				<p className="text-sm font-medium text-neutral-dark">{label}</p>
				<p className="text-xs font-light text-neutral-light-active mt-1 leading-relaxed">
					{description}
				</p>
			</div>
			<Switch checked={checked} onChange={onChange} />
		</div>
	);
}
