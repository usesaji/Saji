"use client";

import Link from "next/link";
import { useApi } from "../../../lib/hooks/useApi";
import {
	dashboard as dashboardApi,
	wallet as walletApi,
	profile as profileApi,
} from "../../../lib/api";
import { pageRoutes } from "../../../config/routes";
import SavingsSummaryCard from "../../../features/overview/SavingsSummaryCard";
import RecentActivities from "../../../features/overview/RecentActivities";
import UsefulInsights from "../../../features/wallet/UsefulInsights";
import UpcomingContribution from "../../../features/wallet/UpcomingContribution";
import WalletConnectButton from "../../../features/wallet/WalletConnectButton";
import { Button } from "../../../components/ui/button";

export default function Page() {
	const { data, loading, error, refetch } = useApi(
		() => dashboardApi.show(),
		[],
	);
	// Linked address (DB) drives the connect state; balance/history are extras.
	const { data: me, refetch: refetchProfile } = useApi(
		() => profileApi.show(),
		[],
	);
	const { data: history } = useApi(() => walletApi.history({ per_page: 20 }), []);
	const { data: saji } = useApi(() => walletApi.sajiBalance(), []);

	const linkedAddress = me?.stellar_address ?? null;
	const txns = history?.data ?? [];
	// Assets that have a claimable circle payout ready (per-asset, e.g. XLM/USDC).
	const claimableAssets = (saji?.assets ?? []).filter(
		(a) => Number(a.claimable_total) > 0,
	);
	const hasClaimable = claimableAssets.length > 0;

	return (
		<div className="mx-auto max-w-3xl pb-10">
			{loading && (
				<p className="mt-6 text-sm text-muted-foreground">Loading wallet…</p>
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

					{/* Payout ready to claim → prompt to withdraw (which claims it).
					    Shown per asset since circles can be XLM / USDC / USDT. */}
					{hasClaimable && (
						<section className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-primary-50 p-4 md:p-6">
							<div className="min-w-0">
								<h5 className="font-medium md:text-lg">
									{claimableAssets
										.map(
											(a) =>
												`${Number(a.claimable_total).toLocaleString()} ${a.asset_code}`,
										)
										.join(" + ")}{" "}
									ready to withdraw
								</h5>
								<p className="mt-1 text-sm font-light text-muted-foreground">
									You&apos;ve received a payout from your circle. Withdraw to
									move it to your wallet.
								</p>
							</div>
							<Button href={pageRoutes.dashboardRoutes.WITHDRAW} size="sm">
								Withdraw
							</Button>
						</section>
					)}

					{/* Wallet link status (non-custodial) + withdraw. */}
					<section className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#f7f7f7] p-4 md:p-6">
						<div className="min-w-0">
							<h5 className="text-xs font-light md:text-sm">Wallet Address</h5>
							<p className="mt-1 break-all text-sm font-medium md:text-base">
								{linkedAddress ?? "No wallet linked yet."}
							</p>
						</div>
						<div className="flex items-center gap-2">
							{linkedAddress && (
								<Button
									href={pageRoutes.dashboardRoutes.WITHDRAW}
									variant="outline"
									size="sm"
								>
									Withdraw
								</Button>
							)}
							<WalletConnectButton
								linkedAddress={linkedAddress}
								onChange={refetchProfile}
							/>
						</div>
					</section>

					<RecentActivities />

					<UsefulInsights data={data} />

					<UpcomingContribution due={data.quick_deposit} />

					{/* Full transaction history (kept from the wallet's core function). */}
					{txns.length > 0 && (
						<section className="mt-8">
							<h4 className="md:text-lg">Wallet History</h4>
							<ul className="mt-4 space-y-2">
								{txns.map((tx) => (
									<li key={tx.id}>
										<Link
											href={pageRoutes.dashboardRoutes.TRANSACTION(tx.id)}
											className="flex items-center justify-between rounded-xl bg-[#f8f8f8] px-4 py-3 transition-colors hover:bg-[#f0f0f0]"
										>
											<div>
												<p className="text-sm font-medium capitalize">
													{tx.type.replace("_", " ")}
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
				</>
			)}
		</div>
	);
}
