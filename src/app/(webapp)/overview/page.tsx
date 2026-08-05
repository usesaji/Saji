"use client";

import { useApi } from "../../../lib/hooks/useApi";
import { dashboard as dashboardApi } from "../../../lib/api";
import SavingsSummaryCard from "../../../features/overview/SavingsSummaryCard";
import LinkWalletPrompt from "../../../features/wallet/LinkWalletPrompt";
import MyActiveGroups from "../../../features/overview/MyActiveGroups";
import DiscoverChallenges from "../../../features/overview/DiscoverChallenges";
import RecentActivities from "../../../features/overview/RecentActivities";
import ExploreCommunities from "../../../features/overview/ExploreCommunities";

export default function Page() {
	const { data, loading, error, refetch } = useApi(
		() => dashboardApi.show(),
		[],
	);

	return (
		<div className="mx-auto max-w-3xl pb-10">
			{loading && (
				<p className="mt-6 text-sm text-muted-foreground">Loading dashboard…</p>
			)}

			{error && !loading && (
				<div className="mt-6 text-sm">
					<p className="text-error-500">{error}</p>
					<button onClick={refetch} className="mt-2 font-medium underline">
						Try again
					</button>
				</div>
			)}

			{data && !loading && (
				<>
					<SavingsSummaryCard data={data} />
					<LinkWalletPrompt />
					<MyActiveGroups circles={data.circles} />
					<DiscoverChallenges />
					<RecentActivities />
					<ExploreCommunities />
				</>
			)}
		</div>
	);
}
