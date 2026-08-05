"use client";

import { useCallback, useEffect, useState } from "react";
import { HiOutlineCheck, HiOutlineExclamationTriangle } from "react-icons/hi2";
import GoBack from "@/components/dashboard/GoBack";
import { Button } from "@/components/ui/button";
import {
	wallet as walletApi,
	withdrawInfo as withdrawInfoApi,
	profile as profileApi,
	ApiError,
} from "@/lib/api";
import { useSavingsContract } from "@/lib/hooks/useSavingsContract";
import { useApi } from "@/lib/hooks/useApi";
import {
	connectWallet,
	currentAddress,
	withdrawToken,
	walletBalances,
} from "@/lib/wallet";
import { tokenFor } from "@/lib/contract/tokens";
import { toast } from "@/lib/utils/toast";
import { pageRoutes } from "@/config/routes";
import Link from "next/link";

const STELLAR_ADDR = /^G[A-Z2-7]{55}$/;

/**
 * Withdraw = two clear, separate stages, kept NON-CUSTODIAL:
 *
 *   Stage 1 — CLAIM your circle EARNINGS. "Available to withdraw" is ONLY the
 *   payouts a completed cycle earmarked for you and that still sit escrowed in
 *   the contract (not your personal wallet balance). Claiming releases them to
 *   your own connected wallet. Saji never holds the money.
 *
 *   Stage 2 — optionally SEND ONWARD from your wallet to an external address
 *   (bank/exchange/another wallet). This moves your OWN wallet funds and is
 *   deliberately separate from claiming earnings.
 */
export default function WithdrawPage() {
	const { claimPayout } = useSavingsContract();
	const { data: me } = useApi(useCallback(() => profileApi.show(), []), []);

	const {
		data: saji,
		loading: balanceLoading,
		refetch: refetchBalance,
	} = useApi(useCallback(() => walletApi.sajiBalance(), []), []);

	// ---- derived: claimable EARNINGS per asset (NOT wallet balance) ----
	const assets = saji?.assets ?? [];
	const claimableOf = useCallback(
		(code: string): number =>
			Number(assets.find((a) => a.asset_code === code)?.claimable_total ?? 0),
		[assets],
	);
	// Assets that actually have earnings to claim.
	const earningAssets = assets.filter((a) => Number(a.claimable_total) > 0);

	// Live wallet balances (client-side) — used only for Stage 2 (send onward).
	const [liveBalances, setLiveBalances] = useState<Record<string, number>>({});
	useEffect(() => {
		let cancelled = false;
		(async () => {
			const addr = (await currentAddress()) ?? me?.stellar_address ?? null;
			if (!addr) return;
			const bals = await walletBalances(addr);
			if (!cancelled) setLiveBalances(bals);
		})();
		return () => {
			cancelled = true;
		};
	}, [me?.stellar_address]);

	// =====================================================================
	// Stage 1 — claim earnings
	// =====================================================================
	const [claiming, setClaiming] = useState<string | null>(null); // asset code

	const claimAsset = async (code: string) => {
		const a = assets.find((x) => x.asset_code === code);
		if (!a || a.claimables.length === 0) return;
		setClaiming(code);
		try {
			for (const c of a.claimables) {
				await claimPayout(c.onchain_group_id);
			}
			toast.success(
				`${claimableOf(code).toLocaleString()} ${code} sent to your wallet.`,
				"Claimed",
			);
			refetchBalance();
			// Refresh wallet balances so the onward-send reflects the claim.
			const addr = (await currentAddress()) ?? me?.stellar_address ?? null;
			if (addr) setLiveBalances(await walletBalances(addr));
		} catch (err) {
			const raw = err instanceof Error ? err.message : "";
			toast.error(
				/User (declined|rejected)|cancell?ed/i.test(raw)
					? "You cancelled the signature."
					: raw || "Could not claim your payout.",
				"Claim failed",
			);
		} finally {
			setClaiming(null);
		}
	};

	// =====================================================================
	// Stage 2 — send onward from wallet
	// =====================================================================
	const [sendAsset, setSendAsset] = useState<string>("XLM");
	const [amount, setAmount] = useState("");
	const [destination, setDestination] = useState("");
	const [saveDestination, setSaveDestination] = useState(false);
	const [connecting, setConnecting] = useState(false);
	const [sending, setSending] = useState(false);

	const { data: savedDests } = useApi(
		useCallback(() => withdrawInfoApi.index(), []),
		[],
	);
	useEffect(() => {
		if (destination || !savedDests || savedDests.length === 0) return;
		const primary = savedDests.find((d) => d.is_primary) ?? savedDests[0];
		setDestination(primary.stellar_address);
	}, [savedDests, destination]);

	const useConnectedWallet = async () => {
		setConnecting(true);
		try {
			const addr = await connectWallet();
			if (addr) setDestination(addr);
		} catch {
			toast.error("Could not connect a wallet for the address.", "Failed");
		} finally {
			setConnecting(false);
		}
	};

	const walletAmt = liveBalances[sendAsset] ?? 0;
	const amountNum = Number(amount) || 0;
	const overBalance = amountNum > walletAmt;
	const destTrim = destination.trim();
	const isSelfDest =
		!!me?.stellar_address &&
		destTrim.toUpperCase() === me.stellar_address.toUpperCase();
	const validDest = STELLAR_ADDR.test(destTrim) && !isSelfDest;

	const [sendPhase, setSendPhase] = useState<
		"idle" | "sending" | "done" | "failed"
	>("idle");
	const [sendError, setSendError] = useState("");

	const sendOnward = async () => {
		setSendError("");
		setSending(true);
		setSendPhase("sending");
		try {
			const from = (await currentAddress()) ?? me?.stellar_address ?? null;
			if (!from) throw new Error("Connect your wallet to send.");
			const token = tokenFor(sendAsset);
			const hash = await withdrawToken({
				from,
				to: destTrim,
				amount,
				code: sendAsset,
				issuer: token.issuer,
			});
			walletApi
				.logWithdrawal({ tx_hash: hash, amount, asset_code: sendAsset })
				.catch(() => {});
			if (saveDestination && destTrim) {
				withdrawInfoApi
					.store({
						stellar_address: destTrim,
						is_primary: savedDests?.length === 0,
					})
					.catch(() => {});
			}
			setSendPhase("done");
			const addr = (await currentAddress()) ?? me?.stellar_address ?? null;
			if (addr) setLiveBalances(await walletBalances(addr));
		} catch (err) {
			const raw = err instanceof Error ? err.message : "";
			setSendError(
				/User (declined|rejected)|cancell?ed/i.test(raw)
					? "You cancelled the signature."
					: err instanceof ApiError
						? err.message
						: raw || "Something went wrong.",
			);
			setSendPhase("failed");
		} finally {
			setSending(false);
		}
	};

	const totalClaimable = earningAssets.reduce(
		(sum, a) => sum + Number(a.claimable_total),
		0,
	);

	return (
		<div className="mx-auto max-w-lg pb-10">
			<GoBack />

			{/* ============ Stage 1: your circle earnings ============ */}
			<h2 className="mt-4 text-lg font-medium md:text-xl">
				Available to withdraw
			</h2>
			<p className="mt-1 text-xs font-light text-muted-foreground">
				Your earnings from circle payouts. Claim them to move the money into
				your connected wallet.
			</p>

			{balanceLoading ? (
				<p className="mt-6 text-sm text-muted-foreground">Loading…</p>
			) : earningAssets.length === 0 ? (
				<div className="mt-4 rounded-2xl bg-[#f7f7f7] p-5 text-center">
					<p className="text-sm text-muted-foreground">
						No earnings to withdraw yet. When a circle pays you, your payout
						shows here to claim.
					</p>
				</div>
			) : (
				<div className="mt-4 space-y-3">
					{earningAssets.map((a) => (
						<div
							key={a.asset_code}
							className="rounded-2xl bg-primary p-5 text-white md:p-6"
						>
							<div className="flex items-center justify-between gap-3">
								<div>
									<p className="text-xs md:text-sm">
										{a.asset_code} earnings
									</p>
									<h3 className="mt-1 text-[28px] font-medium md:text-[34px]">
										{Number(a.claimable_total).toLocaleString()} {a.asset_code}
									</h3>
								</div>
								<Button
									onClick={() => claimAsset(a.asset_code)}
									isLoading={claiming === a.asset_code}
									className="bg-white text-primary hover:bg-white/90"
									size="sm"
								>
									Claim
								</Button>
							</div>
							<ul className="mt-3 space-y-1 border-t border-white/20 pt-3">
								{a.claimables.map((c) => (
									<li
										key={c.group_id}
										className="flex justify-between text-xs font-light text-white/80"
									>
										<span>{c.group_name}</span>
										<span>
											{Number(c.amount).toLocaleString()} {c.asset_code}
										</span>
									</li>
								))}
							</ul>
						</div>
					))}
				</div>
			)}

			{totalClaimable > 0 && (
				<p className="mt-3 text-xs font-light text-muted-foreground">
					Claiming sends the payout to your connected wallet. You can then send
					it onward below.
				</p>
			)}

			{/* ============ Stage 2: send onward from your wallet ============ */}
			<div className="mt-8 border-t border-[#eee] pt-6">
				<h2 className="text-lg font-medium md:text-xl">Send from your wallet</h2>
				<p className="mt-1 text-xs font-light text-muted-foreground">
					Move funds already in your connected wallet out to an external
					address (bank, exchange, or another wallet).
				</p>

				{sendPhase === "done" ? (
					<div className="mt-6 rounded-2xl bg-success-50 p-5 text-center">
						<div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success-700 text-white">
							<HiOutlineCheck className="text-3xl" />
						</div>
						<p className="mt-3 text-sm font-medium text-success-700">
							{amount} {sendAsset} sent to {destTrim.slice(0, 4)}…
							{destTrim.slice(-4)}.
						</p>
						<button
							onClick={() => {
								setSendPhase("idle");
								setAmount("");
							}}
							className="mt-3 text-sm font-medium underline"
						>
							Send again
						</button>
					</div>
				) : (
					<>
						{/* Asset to send */}
						<div className="mt-4 flex gap-2">
							{["XLM", "USDC", "USDT"].map((code) => {
								const active = code === sendAsset;
								return (
									<button
										key={code}
										type="button"
										onClick={() => {
											setSendAsset(code);
											setAmount("");
										}}
										className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium ${
											active
												? "border-primary bg-[#efeaff] text-primary"
												: "border-neutral-light-hover bg-white"
										}`}
									>
										<div>{code}</div>
										<div className="text-[10px] font-light text-muted-foreground">
											{(liveBalances[code] ?? 0).toLocaleString()}
										</div>
									</button>
								);
							})}
						</div>

						{/* Destination */}
						<h3 className="mt-5 text-sm font-medium">Send to</h3>
						<div className="mt-2">
							<div
								className={`flex items-center gap-2 rounded-full border px-4 py-2.5 ${
									destTrim && !validDest
										? "border-error-500"
										: "border-primary"
								}`}
							>
								<input
									type="text"
									value={destination}
									onChange={(e) => setDestination(e.target.value)}
									placeholder="Stellar address (G…)"
									className="w-full min-w-0 bg-transparent text-sm outline-none"
									spellCheck={false}
								/>
								<button
									type="button"
									onClick={useConnectedWallet}
									disabled={connecting}
									className="shrink-0 rounded-full bg-[#efeaff] px-3 py-1.5 text-xs font-medium text-primary disabled:opacity-50"
								>
									{connecting ? "…" : "Use a wallet"}
								</button>
							</div>
							{destTrim && !STELLAR_ADDR.test(destTrim) && (
								<p className="mt-1 text-xs text-error-500">
									That doesn&apos;t look like a valid Stellar address.
								</p>
							)}
							{isSelfDest && (
								<p className="mt-1 text-xs text-error-500">
									That&apos;s your own wallet — enter a different address to
									send it somewhere else.
								</p>
							)}
							<label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
								<input
									type="checkbox"
									checked={saveDestination}
									onChange={(e) => setSaveDestination(e.target.checked)}
								/>
								Save this address for next time
							</label>
						</div>

						{/* Amount */}
						<h3 className="mt-5 text-sm font-medium">Amount</h3>
						<div className="mt-2">
							<div
								className={`flex items-center gap-1 rounded-full border px-6 py-3 ${
									overBalance ? "border-error-500" : "border-primary"
								}`}
							>
								<input
									type="number"
									value={amount}
									onChange={(e) => setAmount(e.target.value)}
									placeholder="0.00"
									className="w-full bg-transparent text-lg outline-none"
								/>
								<span className="text-sm font-medium text-muted-foreground">
									{sendAsset}
								</span>
							</div>
							<button
								type="button"
								onClick={() => walletAmt > 0 && setAmount(String(walletAmt))}
								disabled={walletAmt <= 0}
								className="mt-2 rounded-full bg-[#efeaff] px-4 py-1.5 text-sm text-primary disabled:opacity-50"
							>
								Max ({walletAmt.toLocaleString()})
							</button>
							{overBalance && (
								<p className="mt-2 text-xs text-error-500">
									That&apos;s more than your {sendAsset} wallet balance of{" "}
									{walletAmt.toLocaleString()}.
								</p>
							)}
						</div>

						{sendPhase === "failed" && (
							<div className="mt-4 flex items-center gap-2 rounded-xl bg-error-50 px-4 py-3 text-sm text-error-500">
								<HiOutlineExclamationTriangle />
								{sendError || "The transfer could not be completed."}
							</div>
						)}

						<Button
							className="mt-6 w-full"
							isLoading={sending}
							disabled={!(amountNum > 0) || overBalance || !validDest}
							onClick={sendOnward}
						>
							{sending ? "Sending…" : "Send"}
						</Button>
					</>
				)}
			</div>

			<div className="mt-6 text-center">
				<Link
					href={pageRoutes.dashboardRoutes.WALLET}
					className="text-sm font-medium text-primary underline"
				>
					Back to Wallet
				</Link>
			</div>
		</div>
	);
}
