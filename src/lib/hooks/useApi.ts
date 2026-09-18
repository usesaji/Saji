"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, clearToken } from "../api";
import { pageRoutes } from "../../config/routes";

type ApiState<T> = {
	data: T | null;
	loading: boolean;
	error: string | null;
	/** Re-run the fetch (e.g. a Retry button). */
	refetch: () => void;
};

/**
 * Run an authenticated API client call and track loading/error state, with one
 * shared behaviour every protected screen wants: on a 401 the token is stale,
 * so we clear it and bounce to login rather than showing a broken screen.
 *
 * `fetcher` should be a stable reference (wrap inline closures in useCallback,
 * or pass a module-level client method) so the effect doesn't loop.
 *
 * Usage:
 *   const { data, loading, error, refetch } = useApi(() => groups.index(), []);
 */
export function useApi<T>(
	fetcher: () => Promise<T>,
	deps: React.DependencyList = [],
): ApiState<T> {
	const router = useRouter();
	const [data, setData] = useState<T | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	// Bumping this re-runs the effect for refetch().
	const [tick, setTick] = useState(0);

	const refetch = useCallback(() => setTick((t) => t + 1), []);

	useEffect(() => {
		let cancelled = false;

		setLoading(true);
		setError(null);

		fetcher()
			.then((result) => {
				if (!cancelled) setData(result);
			})
			.catch((err: unknown) => {
				if (cancelled) return;

				// Stale/invalid session — clear and send to login.
				if (err instanceof ApiError && err.status === 401) {
					clearToken();
					router.replace(pageRoutes.authRoutes.LOGIN);
					return;
				}

				setError(
					err instanceof ApiError ? err.message : "Something went wrong.",
				);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});

		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [tick, ...deps]);

	return { data, loading, error, refetch };
}
