"use client";
import React, { useState } from "react";
import GoBack from "../../components/dashboard/GoBack";
import { toast } from "../../lib/utils/toast";
import EditFieldSheet from "./EditFieldSheet";
import PersonalInfoRow from "./PersonalInfoRow";

interface PersonalInfoFields {
	fullName: string;
	email: string;
	personalTag: string;
	dateOfBirth: string;
	gender: string;
	address: string;
}

interface EditingField {
	key: keyof PersonalInfoFields;
	label: string;
	inputType: string;
	value: string;
}

const FIELD_LABELS: Record<keyof PersonalInfoFields, string> = {
	fullName: "Full Name",
	email: "Email Address",
	personalTag: "Personal Tag",
	dateOfBirth: "Date Of Birth",
	gender: "Gender",
	address: "Address",
};

const RESERVED_TAGS = ["admin", "test", "support", "saji"];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateTag(raw: string): string | null {
	const normalized = raw.replace(/^@/, "").trim().toLowerCase();
	if (!normalized) return "Personal tag can't be empty.";
	if (normalized.includes(" ")) return "Oops, this tag has already been taken.";
	if (RESERVED_TAGS.includes(normalized)) return "Oops, this tag has already been taken.";
	return null;
}

export default function PersonalInfoView() {
	const [fields, setFields] = useState<PersonalInfoFields>({
		fullName: "Dean Joseph Ogude",
		email: "deaostudios@gmail.com",
		personalTag: "deanogude",
		dateOfBirth: "",
		gender: "",
		address: "",
	});
	const [editingField, setEditingField] = useState<EditingField | null>(null);

	const profileInfoRows: { key: keyof PersonalInfoFields; inputType: string }[] = [
		{ key: "fullName", inputType: "text" },
		{ key: "email", inputType: "email" },
		{ key: "personalTag", inputType: "text" },
	];

	const additionalInfoRows: { key: keyof PersonalInfoFields; inputType: string }[] = [
		{ key: "dateOfBirth", inputType: "date" },
		{ key: "gender", inputType: "text" },
		{ key: "address", inputType: "text" },
	];

	const handleSaveField = async (fieldKey: string, rawValue: string) => {
		const key = fieldKey as keyof PersonalInfoFields;
		const trimmed = rawValue.trim();

		if (!trimmed) return "This field can't be empty.";
		if (key === "personalTag") {
			const tagError = validateTag(trimmed);
			if (tagError) return tagError;
		}
		if (key === "email" && !EMAIL_REGEX.test(trimmed)) {
			return "Enter a valid email address.";
		}

		await new Promise((resolve) => setTimeout(resolve, 900));

		if (Math.random() < 0.2) {
			setEditingField(null);
			toast.error(
				"Network is currently unstable, give it a moment and try again.",
				"Network Error",
			);
			return null;
		}

		const normalized = key === "personalTag" ? trimmed.replace(/^@/, "").toLowerCase() : trimmed;
		setFields((prev) => ({ ...prev, [key]: normalized }));
		setEditingField(null);
		toast.success(
			`Your ${FIELD_LABELS[key].toLowerCase()} has been successfully updated`,
			"Changes Saved",
		);
		return null;
	};

	return (
		<div className="mx-auto md:max-w-xl lg:max-w-2xl w-full px-0 sm:px-4 py-2">
			<div className="space-y-6">
				<GoBack />

				<h2 className="text-xl font-semibold text-neutral-dark">Personal Info</h2>

				<div>
					<h4 className="text-xs font-light text-neutral-light-active border-b border-neutral-light pb-2.5">
						Profile Info
					</h4>
					<div className="divide-y divide-neutral-light">
						{profileInfoRows.map((row) => (
							<PersonalInfoRow
								key={row.key}
								label={FIELD_LABELS[row.key]}
								value={
									row.key === "personalTag" && fields.personalTag
										? `@ ${fields.personalTag}`
										: fields[row.key] || null
								}
								onEdit={() =>
									setEditingField({
										key: row.key,
										label: FIELD_LABELS[row.key],
										inputType: row.inputType,
										value: fields[row.key],
									})
								}
							/>
						))}
					</div>
				</div>

				<div>
					<h4 className="text-xs font-light text-neutral-light-active border-b border-neutral-light pb-2.5">
						Additional Info
					</h4>
					<div className="divide-y divide-neutral-light">
						{additionalInfoRows.map((row) => (
							<PersonalInfoRow
								key={row.key}
								label={FIELD_LABELS[row.key]}
								value={fields[row.key] || null}
								onEdit={() =>
									setEditingField({
										key: row.key,
										label: FIELD_LABELS[row.key],
										inputType: row.inputType,
										value: fields[row.key],
									})
								}
							/>
						))}
					</div>
				</div>
			</div>

			{editingField && (
				<EditFieldSheet
					key={editingField.key}
					fieldKey={editingField.key}
					fieldLabel={editingField.label}
					inputType={editingField.inputType}
					initialValue={editingField.value}
					onDiscard={() => setEditingField(null)}
					onSave={handleSaveField}
				/>
			)}
		</div>
	);
}
