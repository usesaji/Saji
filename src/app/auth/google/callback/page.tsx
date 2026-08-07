"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { auth, setToken, ApiError } from "../../../../lib/api";
import { pageRoutes } from "../../../../config/routes";
import { toast } from "../../../../lib/utils/toast";

/**
 * Landing spot for the Google OAuth server-side flow.
 *
 * The backend redirects here with `?code=<one-time handoff code>`, NOT the
 * real bearer token — that never touches the URL. We immediately trade the
 * code for the real token over a POST body, persist it, and forward to the
 * dashboard. On error (including an expired/already-used code) we bounce
 * back to login.
 */
export default function GoogleCallbackPage() {
	const router = useRouter();
	const params = useSearchParams();

	useEffect(() => {
		const code = params.get("code");

		if (!code) {
			toast.error("Google sign-in didn't complete.", "Sign-in Failed");
			router.replace(pageRoutes.authRoutes.LOGIN);
			return;
		}

		auth
			.exchangeGoogleCode(code)
			.then(({ token }) => {
				setToken(token);
				toast.success("", "Signed in with Google");
				router.replace(pageRoutes.dashboardRoutes.OVERVIEW);
			})
			.catch((err) => {
				toast.error(
					err instanceof ApiError ? err.message : "Google sign-in didn't complete.",
					"Sign-in Failed",
				);
				router.replace(pageRoutes.authRoutes.LOGIN);
			});
	}, [params, router]);

	return (
		<div className="min-h-screen flex items-center justify-center">
			<p className="text-muted-foreground">Signing you in…</p>
		</div>
	);
}
