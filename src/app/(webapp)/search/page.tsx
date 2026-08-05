"use client";

import { Suspense, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { IoIosArrowRoundForward } from "react-icons/io";
import GoBack from "@/components/dashboard/GoBack";
import { useApi } from "@/lib/hooks/useApi";
import {
	groups as groupsApi,
	challenges as challengesApi,
	transactions as txApi,
} from "@/lib/api";
import { pageRoutes } from "@/config/routes";

/**
 * Search results. There's no unified search endpoint, so we fetch the user's
 * own groups and the public groups, then filter client-side by name. Covers the
 * "search groups" intent; transaction/history search would need a backend query.
 */
function SearchResults() {
	const params = useSearchParams();
	const q = (params.get("q") ?? "").trim();
	const needle = q.toLowerCase();

	const { data: myGroups, loading: loadingMine } = useApi(
		useCallback(() => groupsApi.index(), []),
		[],
	);
	const { data: publicGroups, loading: loadingPublic } = useApi(
		useCallback(() => challengesApi.index({ q, per_page: 20 }), [q]),
		[q],
	);
	const { data: history, loading: loadingHistory } = useApi(
		useCallback(() => txApi.index({ q, per_page: 20 }), [q]),
		[q],
	);

	const mine = (myGroups ?? []).filter((g) =>
		g.name.toLowerCase().includes(needle),
	);
	const open = publicGroups?.data ?? [];
	const txns = history?.data ?? [];
	const loading = loadingMine || loadingPublic || loadingHistory;
	const noResults =
		!loading && mine.length === 0 && open.length === 0 && txns.length === 0;

	return (
		<div className="mx-auto max-w-3xl pb-10">
			<GoBack />
			<h2 className="mt-4 text-xl font-medium md:text-2xl">
				Results for “{q}”
			</h2>

			{loading && (
				<p className="mt-6 text-sm text-muted-foreground">Searching…</p>
			)}

			{noResults && (
				<p className="mt-6 text-sm text-muted-foreground">
					No groups match “{q}”.
				</p>
			)}

			{mine.length > 0 && (
				<section className="mt-6">
					<h4 className="md:text-lg">Your Groups</h4>
					<ul className="mt-3 space-y-2">
						{mine.map((g) => (
							<li key={g.id}>
								<Link
									href={pageRoutes.dashboardRoutes.GROUP(String(g.id))}
									className="flex items-center justify-between rounded-xl bg-[#f8f8f8] px-4 py-3 transition-colors hover:bg-[#f0f0f0]"
								>
									<div>
										<p className="text-sm font-medium">{g.name}</p>
										<p className="text-xs capitalize text-muted-foreground">
											{g.status} ·{" "}
											{g.members_count ?? g.member_count ?? 0} members
										</p>
									</div>
									<IoIosArrowRoundForward className="text-2xl text-muted-foreground" />
								</Link>
							</li>
						))}
					</ul>
				</section>
			)}

			{open.length > 0 && (
				<section className="mt-8">
					<h4 className="md:text-lg">Public Saving Groups</h4>
					<ul className="mt-3 space-y-2">
						{open.map((g) => (
							<li key={g.id}>
								<Link
									href={pageRoutes.dashboardRoutes.GROUP(String(g.id))}
									className="flex items-center justify-between rounded-xl bg-[#f8f8f8] px-4 py-3 transition-colors hover:bg-[#f0f0f0]"
								>
									<div>
										<p className="text-sm font-medium">{g.name}</p>
										<p className="text-xs text-muted-foreground">
											{g.member_count ?? 0} members
											{g.savings_target
												? ` · target ${Number(g.savings_target).toLocaleString()} ${g.asset_code}`
												: ""}
										</p>
									</div>
									<IoIosArrowRoundForward className="text-2xl text-muted-foreground" />
								</Link>
							</li>
						))}
					</ul>
				</section>
			)}

			{txns.length > 0 && (
				<section className="mt-8">
					<h4 className="md:text-lg">History</h4>
					<ul className="mt-3 space-y-2">
						{txns.map((tx) => (
							<li key={tx.id}>
								<Link
									href={pageRoutes.dashboardRoutes.TRANSACTION(tx.id)}
									className="flex items-center justify-between rounded-xl bg-[#f8f8f8] px-4 py-3 transition-colors hover:bg-[#f0f0f0]"
								>
									<div>
										<p className="text-sm font-medium capitalize">
											{tx.type.replace("_", " ")}
											{tx.group ? ` · ${tx.group.name}` : ""}
										</p>
										<p className="text-xs text-muted-foreground">
											{new Date(tx.created_at).toLocaleString()}
										</p>
									</div>
									<span
										className={`text-xs font-medium ${
											tx.status === "success"
												? "text-success-700"
												: tx.status === "failed"
													? "text-error-500"
													: "text-warning-800"
										}`}
									>
										{tx.status}
									</span>
								</Link>
							</li>
						))}
					</ul>
				</section>
			)}
		</div>
	);
}

export default function SearchPage() {
	return (
		<Suspense
			fallback={
				<p className="mt-6 text-sm text-muted-foreground">Loading…</p>
			}
		>
			<SearchResults />
		</Suspense>
	);
}
