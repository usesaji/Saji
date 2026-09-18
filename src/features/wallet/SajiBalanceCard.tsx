"use client";

import { useState } from "react";
import { IoEye, IoEyeOff } from "react-icons/io5";
import { Button } from "../../components/ui/button";
import { pageRoutes } from "../../config/routes";
import type { SajiBalance } from "../../lib/hooks/useSajiBalance";
import { formatStroops } from "../../lib/stroops";

/**
 * "Saji Balance" — payouts a circle has earmarked for this member and that are
 * still escrowed, per asset. Never summed across assets (XLM + USDC is not a
 * number).
 *
 * ESCROW ONLY. This used to add the user's own wallet balance on top, which is
 * what let the Withdraw screen send their own funds and show the balance going
 * DOWN. Money already in the wallet is theirs and is Freighter's business;
 * Saji's job here is what is still held by the contract.
 */
export default function SajiBalanceCard({
	balance,
}: {
	balance: SajiBalance;
}) {
	const [hidden, setHidden] = useState(false);
	const { assets, loading, error, linked, hasWithdrawable, refresh } = balance;

	const fmt = (stroops: bigint) =>
		hidden ? "*****" : formatStroops(stroops);

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
			) : error ? (
				/* Never render a failed read as a zero balance — that tells a user
				   with a real payout that their savings are gone. */
				<div className="mt-3 text-sm">
					<p className="text-error-500">{error}</p>
					<p className="mt-1 text-xs text-muted-foreground">
						Your funds are safe on-chain — we just couldn&apos;t read them.
					</p>
					<button onClick={refresh} className="mt-2 font-medium underline">
						Try again
					</button>
				</div>
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

								{/* Which circles it came from. Each is released separately,
								    so this doubles as the signature count. */}
								<div className="mt-2 space-y-1 text-xs md:text-sm">
									{a.claimables.map((c) => (
										<div
											key={c.onchain_group_id}
											className="flex items-baseline justify-between gap-3"
										>
											<span className="truncate text-muted-foreground">
												{c.group_name}
											</span>
											<span className="shrink-0 font-medium">
												{fmt(c.amount)}
											</span>
										</div>
									))}
								</div>
							</div>
						))}
					</div>
				</>
			)}

			{/* ALWAYS rendered once a wallet is linked, enabled or not.

			    This used to live inside the "you have payouts" branch, so when
			    nothing was claimable the button did not exist anywhere in the app —
			    and since this card is the only Withdraw entry point, the answer to
			    "where do I withdraw?" was genuinely nowhere. A disabled button with
			    a reason is findable; a missing one is not. */}
			{linked && !error && (
				<div className="mt-5">
					<Button
						href={hasWithdrawable ? pageRoutes.dashboardRoutes.WITHDRAW : undefined}
						disabled={!hasWithdrawable}
						className="w-full md:w-auto"
					>
						Withdraw
					</Button>
					{!hasWithdrawable && !loading && (
						<p className="mt-2 text-xs font-light text-muted-foreground">
							Nothing to withdraw yet — a circle has to pay out to you first.
						</p>
					)}
				</div>
			)}
		</section>
	);
}
