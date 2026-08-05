"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import GoBack from "@/components/dashboard/GoBack";
import InputField from "@/components/ui/custom/InputField";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/hooks/useApi";
import { profile as profileApi, fieldErrors, ApiError } from "@/lib/api";
import { pageRoutes } from "@/config/routes";
import { toast } from "@/lib/utils/toast";

type Form = {
	name: string;
	tag_name: string;
	date_of_birth: string;
	gender: string;
	address: string;
};

/** Personal Info — edit display name, @tag, and additional details. */
export default function EditProfilePage() {
	const router = useRouter();
	const { data, loading } = useApi(() => profileApi.show(), []);

	const [form, setForm] = useState<Form>({
		name: "",
		tag_name: "",
		date_of_birth: "",
		gender: "",
		address: "",
	});
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [saving, setSaving] = useState(false);

	// Hydrate the form once the profile loads.
	useEffect(() => {
		if (!data) return;
		setForm({
			name: data.name ?? "",
			tag_name: data.tag_name ?? "",
			date_of_birth: data.date_of_birth ?? "",
			gender: data.gender ?? "",
			address: data.address ?? "",
		});
	}, [data]);

	const set = (key: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) =>
		setForm((f) => ({ ...f, [key]: e.target.value }));

	const onSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setSaving(true);
		setErrors({});
		try {
			await profileApi.update({
				name: form.name,
				tag_name: form.tag_name,
				date_of_birth: form.date_of_birth || null,
				gender: (form.gender || null) as never,
				address: form.address || null,
			});
			toast.success("", "Profile updated");
			router.push(pageRoutes.dashboardRoutes.ME);
		} catch (err) {
			setErrors(fieldErrors(err));
			toast.error(
				err instanceof ApiError ? err.message : "Something went wrong.",
				"Could not save",
			);
		} finally {
			setSaving(false);
		}
	};

	if (loading) {
		return (
			<div>
				<GoBack />
				<p className="mt-6 text-sm text-muted-foreground">Loading…</p>
			</div>
		);
	}

	return (
		<div>
			<GoBack />
			<h2 className="mt-4 text-xl font-light md:text-3xl md:font-normal">
				Personal Info
			</h2>

			<form onSubmit={onSubmit} className="mt-6 max-w-lg space-y-5">
				<InputField
					name="name"
					label="Full Name"
					value={form.name}
					onChange={set("name")}
					error={errors.name}
				/>
				<InputField
					name="tag_name"
					label="Tag"
					placeholder="@yourtag"
					value={form.tag_name}
					onChange={set("tag_name")}
					error={errors.tag_name}
				/>
				<InputField
					name="date_of_birth"
					label="Date of Birth"
					type="date"
					value={form.date_of_birth}
					onChange={set("date_of_birth")}
					error={errors.date_of_birth}
				/>
				<InputField
					name="gender"
					label="Gender (male / female / other / prefer_not_to_say)"
					value={form.gender}
					onChange={set("gender")}
					error={errors.gender}
				/>
				<InputField
					name="address"
					label="Address"
					value={form.address}
					onChange={set("address")}
					error={errors.address}
				/>

				<Button type="submit" isLoading={saving} className="w-full">
					Save Changes
				</Button>
			</form>
		</div>
	);
}
