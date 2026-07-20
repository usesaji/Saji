"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import Logo from "@/components/shared/Logo";
import { pageRoutes } from "@/config/routes";
import { ApiError, auth, setToken } from "@/lib/api";

export default function RegisterPage() {
	const router = useRouter();
	const [form, setForm] = useState({
		name: "",
		email: "",
		password: "",
		password_confirmation: "",
	});
	const [errors, setErrors] = useState<Record<string, string[]>>({});
	const [formError, setFormError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	function update(field: keyof typeof form) {
		return (e: React.ChangeEvent<HTMLInputElement>) =>
			setForm((f) => ({ ...f, [field]: e.target.value }));
	}

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		setLoading(true);
		setErrors({});
		setFormError(null);
		try {
			const { token } = await auth.register(form);
			setToken(token);
			router.push(pageRoutes.landingPage);
		} catch (err) {
			if (err instanceof ApiError) {
				setFormError(err.message);
				if (err.errors) setErrors(err.errors);
			} else {
				setFormError("Something went wrong. Please try again.");
			}
		} finally {
			setLoading(false);
		}
	}

	return (
		<main className="min-h-screen flex items-center justify-center bg-white px-5 py-10">
			<div className="w-full max-w-md">
				<div className="flex justify-center mb-8">
					<Logo />
				</div>

				<h1 className="text-3xl lg:text-4xl font-semibold text-center mb-2">
					Create your account
				</h1>
				<p className="text-center text-neutral-500 mb-8">
					Start saving the West African way.
				</p>

				{formError && (
					<div className="mb-5 rounded-2xl bg-error-500/10 text-error-500 px-4 py-3 text-sm">
						{formError}
					</div>
				)}

				<form onSubmit={onSubmit} className="flex flex-col gap-4">
					<Field
						label="Full name"
						type="text"
						value={form.name}
						onChange={update("name")}
						error={errors.name?.[0]}
						autoComplete="name"
					/>
					<Field
						label="Email"
						type="email"
						value={form.email}
						onChange={update("email")}
						error={errors.email?.[0]}
						autoComplete="email"
					/>
					<Field
						label="Password"
						type="password"
						value={form.password}
						onChange={update("password")}
						error={errors.password?.[0]}
						autoComplete="new-password"
					/>
					<Field
						label="Confirm password"
						type="password"
						value={form.password_confirmation}
						onChange={update("password_confirmation")}
						autoComplete="new-password"
					/>

					<Button
						type="submit"
						variant="default"
						isLoading={loading}
						className="w-full mt-2"
					>
						Get Started
					</Button>
				</form>

				<p className="text-center text-neutral-500 mt-6">
					Already have an account?{" "}
					<a href={pageRoutes.login} className="text-primary font-medium">
						Log in
					</a>
				</p>
			</div>
		</main>
	);
}

function Field({
	label,
	error,
	...props
}: {
	label: string;
	error?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
	return (
		<label className="flex flex-col gap-1.5">
			<span className="text-sm text-neutral-700">{label}</span>
			<input
				{...props}
				required
				className="h-[52px] rounded-2xl border border-neutral-200 px-4 outline-none focus:border-primary transition-colors"
			/>
			{error && <span className="text-xs text-error-500">{error}</span>}
		</label>
	);
}
