"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { setToken } from "../../../../lib/api";
import { pageRoutes } from "../../../../config/routes";
import { toast } from "../../../../lib/utils/toast";

/**
 * Landing spot for the Google OAuth server-side flow.
 *
 * The backend redirects here after Google consent with `?token=<sanctum token>`.
 * We persist it (same store the rest of the app reads) and forward to the
 * dashboard. On error we bounce back to login.
 */
export default function GoogleCallbackPage() {
	const router = useRouter();
	const params = useSearchParams();

	useEffect(() => {
		const token = params.get("token");

		if (!token) {
			toast.error("Google sign-in didn't complete.", "Sign-in Failed");
			router.replace(pageRoutes.authRoutes.LOGIN);
			return;
		}

		setToken(token);
		toast.success("", "Signed in with Google");
		router.replace(pageRoutes.dashboardRoutes.OVERVIEW);
	}, [params, router]);

	return (
		<div className="min-h-screen flex items-center justify-center">
			<p className="text-muted-foreground">Signing you in…</p>
		</div>
	);
}
