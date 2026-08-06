"use client";

import { useState } from "react";
import { IoEye, IoEyeOff } from "react-icons/io5";
import { Button } from "../../components/ui/button";
import { pageRoutes } from "../../config/routes";
import type { SajiBalance } from "../../lib/hooks/useSajiBalance";

/**
 * "Saji Balance" — the money the user can actually withdraw right now.
 *
 * Split per asset into two buckets, never summed across assets (XLM + USDC is
 * not a number). The claimable/wallet split is shown because the two behave
 * differently: claimable is escrowed in a circle and costs a wallet signature
 * per circle to release, wallet funds are already the user's. Crucially, a
 * partial withdrawal moves the remainder from the first bucket to the second —
 * without the split that looks like the balance moved on its own.
 */
export default function SajiBalanceCard({
	balance,
}: {
	balance: SajiBalance;
}) {
	const [hidden, setHidden] = useState(false);
	const { assets, loading, linked, hasWithdrawable } = balance;

	const fmt = (n: number) =>
		hidden ? "*****" : Number(n.toFixed(7)).toLocaleString();

	return (
		<section className="mt-4 rounded-2xl bg-[#f7f7f7] p-4 md:p-6">
			<div className="flex items-center justify-between gap-3">
				<h5 className="text-xs font-light md:text-sm">Saji Balance</h5>
				{linked && assets.length > 0 && (
					<button
						type="button"
						onClick={() => setHidden((h) => !h)}
						className="text-lg text-muted-foreground"
						tabIndex={-1}
						aria-label={hidden ? "Show balance" : "Hide balance"}
					>
						{hidden ? <IoEyeOff /> : <IoEye />}
					</button>
				)}
			</div>

			{loading ? (
				<p className="mt-3 text-sm text-muted-foreground">
					Checking your balances…
				</p>
			) : !linked ? (
				<p className="mt-3 text-sm text-muted-foreground">
					Add a wallet address to your account to see your Saji Balance.
				</p>
			) : assets.length === 0 ? (
				<p className="mt-3 text-sm text-muted-foreground">
					No payouts yet. When a circle pays you, it shows up here.
				</p>
			) : (
				<>
					<div className="mt-3 space-y-4">
						{assets.map((a) => (
							<div key={a.asset_code}>
								<p className="text-2xl font-medium md:text-3xl">
									{fmt(a.total)}{" "}
									<span className="text-base font-light text-muted-foreground md:text-lg">
										{a.asset_code}
									</span>
								</p>

								<div className="mt-2 space-y-1 text-xs md:text-sm">
									{a.claimable_total > 0 && (
										<div className="flex items-baseline justify-between gap-3">
											<span className="text-muted-foreground">
												Ready to claim
												{a.claimables.length > 0 && (
													<span className="ml-1 font-light">
														· from{" "}
														{a.claimables
															.map((c) => c.group_name)
															.join(", ")}
													</span>
												)}
											</span>
											<span className="shrink-0 font-medium">
												{fmt(a.claimable_total)}
											</span>
										</div>
									)}
									{a.wallet_total > 0 && (
										<div className="flex items-baseline justify-between gap-3">
											<span className="text-muted-foreground">
												Claimed
												<span className="ml-1 font-light">· ready to send</span>
											</span>
											<span className="shrink-0 font-medium">
												{fmt(a.wallet_total)}
											</span>
										</div>
									)}
								</div>
							</div>
						))}
					</div>

					{hasWithdrawable && (
						<Button
							href={pageRoutes.dashboardRoutes.WITHDRAW}
							className="mt-5 w-full md:w-auto"
						>
							Withdraw
						</Button>
					)}
				</>
			)}
		</section>
	);
}
