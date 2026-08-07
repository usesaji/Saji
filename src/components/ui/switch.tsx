"use client";
import React from "react";

interface SwitchProps {
	checked: boolean;
	onChange: (checked: boolean) => void;
	disabled?: boolean;
}

export function Switch({ checked, onChange, disabled }: SwitchProps) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			disabled={disabled}
			onClick={() => onChange(!checked)}
			className={`w-11 h-6 rounded-full shrink-0 transition-colors relative cursor-pointer border-0 disabled:cursor-not-allowed disabled:opacity-50 ${
				checked ? "bg-primary" : "bg-neutral-light-hover"
			}`}
		>
			<span
				className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
					checked ? "translate-x-5" : "translate-x-0"
				}`}
			/>
		</button>
	);
}
