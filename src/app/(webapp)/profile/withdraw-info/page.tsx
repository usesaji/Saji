"use client";

import { useState } from "react";
import GoBack from "@/components/dashboard/GoBack";
import InputField from "@/components/ui/custom/InputField";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/hooks/useApi";
import { withdrawInfo as wiApi, fieldErrors, ApiError } from "@/lib/api";
import { toast } from "@/lib/utils/toast";

/** Withdraw Info — saved payout destinations (public Stellar addresses only). */
export default function WithdrawInfoPage() {
	const { data, loading, error, refetch } = useApi(() => wiApi.index(), []);

	const [form, setForm] = useState({ stellar_address: "", destination_label: "" });
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [saving, setSaving] = useState(false);

	const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
		setForm((f) => ({ ...f, [key]: e.target.value }));

	const add = async (e: React.FormEvent) => {
		e.preventDefault();
		setSaving(true);
		setErrors({});
		try {
			await wiApi.store({
				stellar_address: form.stellar_address,
				destination_label: form.destination_label || null,
			});
			setForm({ stellar_address: "", destination_label: "" });
			toast.success("", "Destination added");
			refetch();
		} catch (err) {
			setErrors(fieldErrors(err));
			toast.error(
				err instanceof ApiError ? err.message : "Something went wrong.",
				"Could not add",
			);
		} finally {
			setSaving(false);
		}
	};

	const makePrimary = async (id: number) => {
		try {
			await wiApi.setPrimary(id);
			toast.success("", "Primary destination updated");
			refetch();
		} catch (err) {
			toast.error(
				err instanceof ApiError ? err.message : "Something went wrong.",
				"Could not update",
			);
		}
	};

	const remove = async (id: number) => {
		try {
			await wiApi.destroy(id);
			toast.success("", "Destination removed");
			refetch();
		} catch (err) {
			toast.error(
				err instanceof ApiError ? err.message : "Something went wrong.",
				"Could not remove",
			);
		}
	};

	return (
		<div>
			<GoBack />
			<h2 className="mt-4 text-xl font-light md:text-3xl md:font-normal">
				Withdraw Destinations
			</h2>

			{/* Existing destinations */}
			<section className="mt-6 space-y-3">
				{loading && (
					<p className="text-sm text-muted-foreground">Loading…</p>
				)}
				{error && !loading && (
					<div className="text-sm">
						<p className="text-error-500">{error}</p>
						<button onClick={refetch} className="mt-2 font-medium underline">
							Try again
						</button>
					</div>
				)}
				{!loading && !error && (data?.length ?? 0) === 0 && (
					<p className="text-sm text-muted-foreground">
						No destinations saved yet.
					</p>
				)}

				{data?.map((d) => (
					<div
						key={d.id}
						className="rounded-2xl bg-[#f7f7f7] p-4 md:p-6"
					>
						<div className="flex items-start justify-between gap-3">
							<div className="min-w-0">
								<p className="text-sm font-medium md:text-base">
									{d.destination_label ?? "Destination"}
									{d.is_primary && (
										<span className="ml-2 rounded-full bg-success-50 px-2 py-0.5 text-xs text-success-700">
											Primary
										</span>
									)}
								</p>
								<p className="mt-1 break-all text-xs text-muted-foreground md:text-sm">
									{d.stellar_address}
								</p>
							</div>
						</div>
						<div className="mt-3 flex gap-2">
							{!d.is_primary && (
								<Button
									variant="outline"
									size="sm"
									onClick={() => makePrimary(d.id)}
								>
									Make Primary
								</Button>
							)}
							<Button
								variant="destructive"
								size="sm"
								onClick={() => remove(d.id)}
							>
								Remove
							</Button>
						</div>
					</div>
				))}
			</section>

			{/* Add a new destination */}
			<form onSubmit={add} className="mt-8 max-w-lg space-y-5">
				<h3 className="md:text-xl">Add Destination</h3>
				<InputField
					name="stellar_address"
					label="Stellar Address (G…)"
					placeholder="G..."
					value={form.stellar_address}
					onChange={set("stellar_address")}
					error={errors.stellar_address}
				/>
				<InputField
					name="destination_label"
					label="Label (optional)"
					placeholder="e.g. My main wallet"
					value={form.destination_label}
					onChange={set("destination_label")}
					error={errors.destination_label}
				/>
				<Button type="submit" isLoading={saving} className="w-full">
					Add Destination
				</Button>
			</form>
		</div>
	);
}
