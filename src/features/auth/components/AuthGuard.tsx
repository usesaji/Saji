"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/api";
import { pageRoutes } from "@/config/routes";
import PageLoading from "@/components/shared/PageLoading";

/**
 * Client-side gate for the authenticated (webapp) area.
 *
 * The Sanctum bearer token lives in localStorage, which is browser-only — a
 * server component or middleware can't see it — so the guard has to run on the
 * client. Until we've confirmed a token exists we render a loading state rather
 * than the protected UI, then redirect to login when there's no token.
 */
export default function AuthGuard({ children }: { children: React.ReactNode }) {
	const router = useRouter();
	const [checked, setChecked] = useState(false);

	useEffect(() => {
		if (!getToken()) {
			router.replace(pageRoutes.authRoutes.LOGIN);
			return;
		}
		setChecked(true);
	}, [router]);

	// Don't flash protected content before the token check resolves.
	if (!checked) return <PageLoading />;

	return <>{children}</>;
}
