"use client";

import Link from "next/link";
import { HiChevronRight } from "react-icons/hi2";
import { useEffect, useState } from "react";
import { useApi } from "../../../lib/hooks/useApi";
import { profile as profileApi, assetUrl } from "../../../lib/api";
import ImageUpload from "../../../components/shared/ImageUpload";
import { pageRoutes } from "../../../config/routes";

const AVATAR_PLACEHOLDER = "/images/user.jpg";

export default function Page() {
	const { data, loading, error, refetch } = useApi(() => profileApi.show(), []);

	// Local copy of the avatar so an upload reflects immediately without refetch.
	const [avatar, setAvatar] = useState<string | null>(null);
	useEffect(() => {
		if (data) setAvatar(data.avatar_url);
	}, [data]);

	if (loading) {
		return <p className="mt-6 text-sm text-muted-foreground">Loading profile…</p>;
	}

	if (error || !data) {
		return (
			<div className="mt-6 text-sm">
				<p className="text-error-500">{error ?? "Could not load profile."}</p>
				<button onClick={refetch} className="mt-2 font-medium underline">
					Try again
				</button>
			</div>
		);
	}

	const rows: { label: string; value: string }[] = [
		{ label: "Full Name", value: data.name },
		{ label: "Tag", value: data.tag_name ? `@${data.tag_name}` : "—" },
		{ label: "Email", value: data.email },
		{ label: "Date of Birth", value: data.date_of_birth ?? "—" },
		{ label: "Gender", value: data.gender ?? "—" },
		{ label: "Address", value: data.address ?? "—" },
		{
			label: "Wallet",
			value: data.stellar_address ?? "Not linked",
		},
		{
			label: "Sign-in",
			value: data.is_google_linked ? "Google" : "Email & password",
		},
	];

	return (
		<div>
			<h2 className="text-xl font-light md:text-3xl md:font-normal">Profile</h2>

			<div className="mt-5 flex items-center gap-4">
				<ImageUpload
					variant="avatar"
					src={assetUrl(avatar)}
					placeholder={AVATAR_PLACEHOLDER}
					alt={data.name}
					onUpload={async (file) => {
						const { avatar_url } = await profileApi.uploadAvatar(file);
						setAvatar(avatar_url);
						return assetUrl(avatar_url);
					}}
				/>
				<div>
					<p className="text-lg font-medium">{data.name}</p>
					{data.tag_name && (
						<p className="text-sm text-muted-foreground">@{data.tag_name}</p>
					)}
				</div>
			</div>

			<div className="mt-6 space-y-3">
				{rows.map((r) => (
					<div
						key={r.label}
						className="flex justify-between gap-4 border-b border-b-[#d9d9d9] pb-2"
					>
						<span className="text-sm font-light md:text-base">{r.label}</span>
						<span className="break-all text-right text-sm font-medium md:text-base">
							{r.value}
						</span>
					</div>
				))}
			</div>

			{/* Settings sub-pages */}
			<div className="mt-8 space-y-3">
				{[
					{ label: "Edit Personal Info", href: pageRoutes.dashboardRoutes.PROFILE_EDIT },
					{ label: "Password & Security", href: pageRoutes.dashboardRoutes.PROFILE_SECURITY },
					{ label: "Withdraw Destinations", href: pageRoutes.dashboardRoutes.WITHDRAW_INFO },
				].map((item) => (
					<Link
						key={item.href}
						href={item.href}
						className="flex items-center justify-between rounded-2xl bg-[#f7f7f7] px-4 py-4 transition-colors hover:bg-[#f0f0f0] md:px-6"
					>
						<span className="text-sm font-medium md:text-base">{item.label}</span>
						<HiChevronRight className="text-xl text-muted-foreground" />
					</Link>
				))}
			</div>
		</div>
	);
}
