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
import SajiBalanceCard from "../../../features/wallet/SajiBalanceCard";
import { useSajiBalance } from "../../../lib/hooks/useSajiBalance";

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
	// Saji Balance is read BROWSER-SIDE, not via wallet.sajiBalance() — that
	// endpoint's RPC reads die behind the DNS wall and silently report 0, which
	// is why a waiting payout never used to show here.
	const saji = useSajiBalance();

	const linkedAddress = me?.stellar_address ?? null;
	const txns = history?.data ?? [];

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

			{/* OUTSIDE the dashboard gate on purpose. This card owns its own
			    loading and error states and reads the chain independently, but it
			    used to render only when the DASHBOARD request had resolved — so a
			    slow or failing dashboard took the balance AND the only Withdraw
			    button off the page entirely, with nothing explaining why. */}
			<SajiBalanceCard balance={saji} />

			{data && !loading && (
				<>
					<SavingsSummaryCard data={data} />

					{/* Wallet link status (non-custodial). */}
					<section className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#f7f7f7] p-4 md:p-6">
						<div className="min-w-0">
							<h5 className="text-xs font-light md:text-sm">Wallet Address</h5>
							<p className="mt-1 break-all text-sm font-medium md:text-base">
								{linkedAddress ?? "No wallet linked yet."}
							</p>
						</div>
						<WalletConnectButton
							linkedAddress={linkedAddress}
							onChange={refetchProfile}
						/>
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
												{/* `kind`, not `type` — the latter reads "payout"
												    for money LEAVING as well as arriving. */}
												<p className="text-sm font-medium capitalize">
													{tx.kind.replace("_", " ")}
													{tx.amount && (
														<span className="ml-2 font-light text-muted-foreground">
															{tx.amount}
														</span>
													)}
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
