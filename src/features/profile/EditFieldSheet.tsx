"use client";
import React, { useState } from "react";
import { Button } from "../../components/ui/button";
import InputField from "../../components/ui/custom/InputField";

interface EditFieldSheetProps {
	fieldKey: string;
	fieldLabel: string;
	inputType?: string;
	initialValue: string;
	onDiscard: () => void;
	onSave: (fieldKey: string, value: string) => Promise<string | null>;
}

export default function EditFieldSheet({
	fieldKey,
	fieldLabel,
	inputType = "text",
	initialValue,
	onDiscard,
	onSave,
}: EditFieldSheetProps) {
	const [value, setValue] = useState(initialValue);
	const [error, setError] = useState<string | null>(null);
	const [isSaving, setIsSaving] = useState(false);

	const handleSave = async () => {
		setIsSaving(true);
		setError(null);
		const validationError = await onSave(fieldKey, value.trim());
		setIsSaving(false);
		if (validationError) {
			setError(validationError);
		}
	};

	return (
		<div
			className="fixed inset-0 z-1100 flex items-end sm:items-center justify-center bg-black/40 px-0 sm:px-4"
			onClick={() => !isSaving && onDiscard()}
		>
			<div
				onClick={(e) => e.stopPropagation()}
				className="bg-white rounded-t-3xl sm:rounded-3xl p-6 pt-3 sm:p-8 w-full max-w-md shadow-xl"
			>
				<span className="sm:hidden w-10 h-1.25 rounded-full bg-neutral-light mb-5 mx-auto block" />

				<InputField
					name={fieldKey}
					label={fieldLabel}
					type={inputType}
					value={value}
					onChange={(e) => setValue(e.target.value)}
					error={error}
				/>
				{error && <p className="text-xs text-accent mt-1.5">{error}</p>}

				<div className="flex items-center gap-3 mt-6 w-full">
					<button
						type="button"
						onClick={onDiscard}
						disabled={isSaving}
						className="flex-1 h-12 rounded-full bg-neutral-comment text-neutral-dark font-semibold text-sm cursor-pointer border-0 disabled:cursor-not-allowed disabled:opacity-60"
					>
						Discard
					</button>
					<Button type="button" onClick={handleSave} isLoading={isSaving} className="flex-1">
						Save &amp; Continue
					</Button>
				</div>
			</div>
		</div>
	);
}
