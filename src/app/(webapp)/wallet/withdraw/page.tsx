"use client";

import { useCallback, useState } from "react";
import {
	HiOutlineCheck,
	HiOutlineExclamationTriangle,
	HiOutlineWallet,
	HiOutlineXMark,
} from "react-icons/hi2";
import { IoAddOutline } from "react-icons/io5";
import GoBack from "@/components/dashboard/GoBack";
import { Button } from "@/components/ui/button";
import {
	wallet as walletApi,
	withdrawInfo as withdrawInfoApi,
	profile as profileApi,
	dashboard as dashboardApi,
	type WithdrawDestination,
	ApiError,
} from "@/lib/api";
import { useSavingsContract } from "@/lib/hooks/useSavingsContract";
import { useApi } from "@/lib/hooks/useApi";
import { useSajiBalance } from "@/lib/hooks/useSajiBalance";
import { whenLabel as dueLabel } from "@/features/wallet/UpcomingContribution";
import {
	currentAddress,
	hasTrustline,
	spendableBalance,
	withdrawToken,
} from "@/lib/wallet";
import { tokenFor } from "@/lib/contract/tokens";
import { pageRoutes } from "@/config/routes";

const STELLAR_ADDR = /^G[A-Z2-7]{55}$/;
// Network fee for a Stellar payment (base fee, in whole XLM). Shown as the only
// real fee — there is no Saji processing fee or VAT on a self-custody transfer.
const NETWORK_FEE_XLM = 0.00001;

type Phase = "form" | "processing" | "completed" | "failed";

/**
 * Withdraw — single-action screen (matches the Saji design):
 *   amount → destination account → Confirm Withdrawal.
 *
 * The withdrawable balance is the user's Saji Balance: circle payouts still
 * escrowed (claimable) PLUS anything already in their wallet. "Confirm
 * Withdrawal" releases as much of the claimable as the amount needs, then sends
 * that amount to the chosen destination. On-chain the contract can only release
 * to the member's own wallet, so this claims to their wallet then forwards —
 * surfaced as one action. Non-custodial throughout.
 */
export default function WithdrawPage() {
	const { claimPayout } = useSavingsContract();
	const { data: me } = useApi(useCallback(() => profileApi.show(), []), []);

	// Saji Balance, read browser-side (see the hook on why not sajiBalance()).
	const {
		assets: earningAssets,
		loading,
		refresh,
	} = useSajiBalance();

	const { data: savedDests, refetch: refetchDests } = useApi(
		useCallback(() => withdrawInfoApi.index(), []),
		[],
	);

	// Soonest-due contribution — surfaced as a dismissible footnote so a user
	// doesn't withdraw the tokens they still owe a circle.
	const { data: dashboardData } = useApi(
		useCallback(() => dashboardApi.show(), []),
		[],
	);
	const [dueDismissed, setDueDismissed] = useState(false);
	const due = dashboardData?.quick_deposit ?? null;

	// `asset` is only the user's explicit tab choice. It's resolved against the
	// live list rather than trusted directly: an asset can disappear between
	// renders (you withdrew all of it), and a stale code would otherwise leave
	// the form showing that asset with a 0 balance.
	const [asset, setAsset] = useState<string | null>(null);
	const selected =
		earningAssets.find((a) => a.asset_code === asset) ?? earningAssets[0];
	const selectedCode = selected?.asset_code ?? "XLM";
	// Withdrawable = what's still locked in circles + what's already in the wallet.
	const available = Number(selected?.total ?? 0);

	const [amount, setAmount] = useState("");
	const [destId, setDestId] = useState<number | null>(null);
	const [phase, setPhase] = useState<Phase>("form");
	const [errorMsg, setErrorMsg] = useState("");
	// What actually went out — can be less than requested if the XLM reserve
	// capped it, so the success screen must not quote the requested amount.
	const [sentAmount, setSentAmount] = useState("");
	// Total released from circles by this withdrawal. When it exceeds what was
	// sent, the surplus landed in the user's wallet and the success screen has to
	// say so — otherwise their Saji Balance appears to move for no reason.
	const [claimedAmount, setClaimedAmount] = useState(0);

	// Add-destination modal.
	const [showAdd, setShowAdd] = useState(false);

	// The selected destination defaults to the primary (or first) saved one, and
	// is derived rather than stored so no effect has to sync it once the list
	// loads. `destId` is only ever the user's explicit override.
	const dest =
		savedDests?.find((d) => d.id === destId) ??
		savedDests?.find((d) => d.is_primary) ??
		savedDests?.[0] ??
		null;
	const amountNum = Number(amount) || 0;
	const overBalance = amountNum > available;
	// Withdrawing to your OWN wallet is fine and common — your earnings live in
	// the contract (claimable), not your wallet, so "withdraw to my wallet" just
	// means "claim my earnings home". No self-destination block.
	const canConfirm = amountNum > 0 && !overBalance && !!dest && !!selected;

	// Quick-amount chips. The design shows fixed denominations (₦15,000 …), but a
	// claimable payout is an arbitrary on-chain amount — a fixed chip would often
	// exceed it and be dead. So these are fractions of what's actually available,
	// which always produce a valid amount.
	const chips = [
		{ label: "25%", value: available * 0.25 },
		{ label: "50%", value: available * 0.5 },
		{ label: "75%", value: available * 0.75 },
	].filter((c) => c.value > 0);

	const confirm = async () => {
		if (!selected || !dest) return;
		setErrorMsg("");
		setPhase("processing");
		try {
			const from = me?.stellar_address ?? (await currentAddress()) ?? null;
			if (!from)
				throw new Error(
					"No wallet address on your account yet — add one in your profile to receive payouts.",
				);
			const token = tokenFor(selectedCode);
			const to = dest.stellar_address;

			// The contract pays the DESTINATION directly, so it's the destination
			// that needs the trustline. We can't create one on someone else's
			// account — fail early with a clear message instead of letting the
			// claim revert on-chain.
			if (!token.native && token.issuer) {
				if (!(await hasTrustline(to, token.code, token.issuer))) {
					throw new Error(
						`That destination can't receive ${selectedCode} yet. It needs a ${selectedCode} trustline before you can withdraw to it.`,
					);
				}
			}

			const walletHas = Number(selected.wallet_total ?? 0);
			// A circle payout releases in FULL — claim_payout takes no amount. So a
			// partial withdrawal can't be claimed straight out to the destination
			// without overshooting. Two paths:
			//   • full amount  → claim direct to destination (ONE signature, no hop)
			//   • partial      → claim home, then send exactly what was asked
			const claimsNeeded = amountNum - walletHas > 0;
			const wholeClaimable =
				amountNum >= Number(selected.total ?? 0) - 0.0000001;
			const claimDirect = claimsNeeded && wholeClaimable && walletHas <= 0;

			let claimed = 0;
			let needed = amountNum - walletHas;
			if (claimsNeeded) {
				// Largest circles first keeps the signature count down.
				const byLargest = [...selected.claimables].sort(
					(a, b) => Number(b.amount) - Number(a.amount),
				);
				for (const c of byLargest) {
					if (needed <= 0) break;
					const stroops = await claimPayout(
						c.onchain_group_id,
						claimDirect ? to : from,
					);
					const got = Number(stroops) / 10_000_000;
					claimed += got;
					needed -= got;
				}
			}
			setClaimedAmount(claimDirect ? 0 : claimed);

			if (claimDirect) {
				// The contract already paid the destination — nothing left to send.
				walletApi
					.logWithdrawal({
						tx_hash: "",
						amount: claimed.toFixed(7),
						asset_code: selectedCode,
					})
					.catch(() => {});
				setSentAmount(claimed.toFixed(7));
				setPhase("completed");
				refresh();
				return;
			}

			// Partial (or wallet-funded): forward the requested amount from the
			// user's own wallet. Only now is its real balance known. For XLM the
			// account must retain its base reserve + fee, so sending everything
			// would fail op_underfunded — clamp to what's actually spendable.
			const spendable = await spendableBalance(from, selectedCode);
			if (spendable <= 0) {
				throw new Error(
					selectedCode === "XLM"
						? "Your XLM balance is fully committed to the account reserve. Keep a little more XLM in your wallet to cover the reserve and fee."
						: `No spendable ${selectedCode} in your wallet.`,
				);
			}
			const sendAmount = Math.min(amountNum, spendable).toFixed(7);

			const hash = await withdrawToken({
				from,
				to,
				amount: sendAmount,
				code: selectedCode,
				issuer: token.issuer,
			});
			walletApi
				.logWithdrawal({
					tx_hash: hash,
					amount: sendAmount,
					asset_code: selectedCode,
				})
				.catch(() => {});

			setSentAmount(sendAmount);
			setPhase("completed");
			refresh();
		} catch (err) {
			const raw = err instanceof Error ? err.message : "";
			setErrorMsg(
				/User (declined|rejected)|cancell?ed/i.test(raw)
					? "You cancelled the signature."
					: // The DESTINATION can't hold this asset — only its owner can fix
						// that, so name the asset instead of showing a Horizon code.
						/trustline entry is missing|no trust/i.test(raw)
						? `That destination can't receive ${selectedCode} yet. It needs a ${selectedCode} trustline before you can withdraw to it.`
						: err instanceof ApiError
							? err.message
							: raw || "The withdrawal could not be completed.",
			);
			setPhase("failed");
		}
	};

	// ---- Result states ----
	if (phase === "processing" || phase === "completed" || phase === "failed") {
		return (
			<div className="mx-auto max-w-lg pb-10">
				<GoBack />
				<div className="py-16 text-center">
					{phase === "processing" && (
						<>
							<div className="mx-auto h-16 w-16 animate-spin rounded-full border-4 border-primary border-t-transparent" />
							<h2 className="mt-6 text-xl font-medium">Processing withdrawal</h2>
							<p className="mt-2 text-sm text-muted-foreground">
								Approve the transaction{claimedAmount > 0 ? "s" : ""} when
								prompted — we&apos;re releasing your payout and sending it to
								your destination.
							</p>
						</>
					)}
					{phase === "completed" && (
						<>
							<div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-primary text-white">
								<HiOutlineCheck className="text-5xl" />
							</div>
							<h2 className="mt-6 text-xl font-medium">Withdrawal Completed</h2>
							<p className="mt-2 text-sm text-muted-foreground">
								{Number(sentAmount || amount).toLocaleString()} {selectedCode} is
								on its way to your destination.
							</p>
							{Number(sentAmount) < Number(amount) && (
								<p className="mt-2 text-xs text-muted-foreground">
									Slightly less than you asked for — your account has to keep a
									small XLM reserve on-chain.
								</p>
							)}
							{/* A circle payout releases in full, so a partial withdrawal
							    leaves the remainder in the user's wallet. Say so, or their
							    Saji Balance looks like it moved for no reason. */}
							{claimedAmount - Number(sentAmount) > 0.0000001 && (
								<p className="mt-3 text-xs text-muted-foreground">
									The other{" "}
									{Number(
										(claimedAmount - Number(sentAmount)).toFixed(7),
									).toLocaleString()}{" "}
									{selectedCode} was released into your wallet and is still in
									your Saji Balance — withdraw it anytime, no extra approval
									needed.
								</p>
							)}
							<Button
								href={pageRoutes.dashboardRoutes.WALLET}
								className="mt-6 w-full"
							>
								Back to Wallet
							</Button>
						</>
					)}
					{phase === "failed" && (
						<>
							<div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-error-500 text-white">
								<HiOutlineExclamationTriangle className="text-5xl" />
							</div>
							<h2 className="mt-6 text-xl font-medium">Withdrawal Failed</h2>
							<p className="mt-2 text-sm text-muted-foreground">
								{errorMsg || "The withdrawal could not be completed."}
							</p>
							<button
								onClick={() => setPhase("form")}
								className="mt-6 font-medium underline"
							>
								Try again
							</button>
						</>
					)}
				</div>
			</div>
		);
	}

	// ---- Form ----
	return (
		<div className="mx-auto max-w-2xl pb-10">
			<GoBack />
			<h2 className="mt-4 text-lg font-medium md:text-2xl">Withdraw</h2>

			{loading ? (
				<p className="mt-6 text-sm text-muted-foreground">Loading…</p>
			) : earningAssets.length === 0 ? (
				<div className="mt-4 rounded-2xl bg-[#f7f7f7] p-6 text-center text-sm text-muted-foreground">
					Nothing to withdraw yet. Circle payouts and any balance in your wallet
					show up here.
				</div>
			) : (
				<>
					{/* Asset selector — earnings can be in XLM / USDC / USDT. Shown even
					    for a single asset so the balance is never ambiguous about which
					    of your assets it refers to. */}
					<div className="mt-5 flex flex-wrap gap-2">
						{earningAssets.map((a) => {
							const active = a.asset_code === selectedCode;
							return (
								<button
									key={a.asset_code}
									type="button"
									aria-pressed={active}
									onClick={() => {
										setAsset(a.asset_code);
										setAmount("");
									}}
									className={`rounded-xl border px-4 py-2 text-left text-sm font-medium transition-colors ${
										active
											? "border-primary bg-[#efeaff] text-primary"
											: "border-neutral-light-hover bg-white hover:bg-[#f7f7f7]"
									}`}
								>
									{a.asset_code}
									<span className="ml-2 font-light text-muted-foreground">
										{Number(a.total).toLocaleString()}
									</span>
								</button>
							);
						})}
					</div>

					{/* Amount */}
					<p className="mt-6 text-sm font-light">
						How much would you like to withdraw?
					</p>
					<div
						className={`mt-2 flex items-center gap-3 rounded-full border-2 px-6 py-4 ${
							overBalance ? "border-error-500" : "border-primary"
						}`}
					>
						<span className="shrink-0 text-xl font-medium text-muted-foreground md:text-2xl">
							{selectedCode}
						</span>
						<input
							type="number"
							value={amount}
							onChange={(e) => setAmount(e.target.value)}
							placeholder="0.00"
							className="w-full bg-transparent text-xl outline-none md:text-2xl"
						/>
					</div>
					<p className="mt-2 text-xs font-light text-muted-foreground">
						Available: {available.toLocaleString()} {selectedCode}
					</p>
					<div className="mt-3 flex flex-wrap gap-2">
						{chips.map((c) => {
							const v = Number(c.value.toFixed(7));
							return (
								<button
									key={c.label}
									type="button"
									onClick={() => setAmount(String(v))}
									className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
										amount === String(v)
											? "bg-primary text-white"
											: "bg-[#efeaff] text-primary hover:bg-[#e4dcff]"
									}`}
								>
									{c.label}
								</button>
							);
						})}
						<button
							type="button"
							onClick={() => setAmount(String(available))}
							className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
								amount === String(available)
									? "bg-primary text-white"
									: "bg-[#efeaff] text-primary hover:bg-[#e4dcff]"
							}`}
						>
							Max
						</button>
					</div>
					{overBalance && (
						<p className="mt-2 text-xs text-error-500">
							That&apos;s more than your available {available.toLocaleString()}{" "}
							{selectedCode}.
						</p>
					)}

					{/* Destination Account */}
					<div className="mt-8 flex items-center justify-between">
						<h3 className="text-base font-medium">Destination Account</h3>
						<button
							type="button"
							onClick={() => setShowAdd(true)}
							className="flex items-center gap-1 text-sm font-medium text-primary"
						>
							<IoAddOutline /> Add New
						</button>
					</div>

					{(savedDests?.length ?? 0) === 0 ? (
						<button
							type="button"
							onClick={() => setShowAdd(true)}
							className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-primary/40 bg-[#f7f7f7] px-4 py-6 text-sm text-primary"
						>
							<IoAddOutline className="text-lg" /> Add a wallet address to
							withdraw to
						</button>
					) : (
						<div className="mt-3 grid gap-3 sm:grid-cols-2">
							{savedDests!.map((d) => {
								const sel = d.id === dest?.id;
								return (
									<button
										key={d.id}
										type="button"
										aria-pressed={sel}
										onClick={() => setDestId(d.id)}
										className={`flex items-center justify-between gap-3 rounded-2xl border p-4 text-left transition-colors ${
											sel
												? "border-primary bg-[#efeaff]"
												: "border-[#eee] bg-[#f8f8f8] hover:bg-[#f0f0f0]"
										}`}
									>
										<span className="flex min-w-0 items-center gap-3">
											<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-lg text-primary">
												<HiOutlineWallet />
											</span>
											<span className="min-w-0">
												<span className="block truncate text-sm font-medium">
													{d.destination_label ?? "Wallet"}
												</span>
												<span className="mt-0.5 block text-xs text-muted-foreground">
													Address ending {d.stellar_address.slice(-4)}
												</span>
											</span>
										</span>
										<span
											className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
												sel
													? "bg-primary text-white"
													: "border border-neutral-light-hover"
											}`}
										>
											{sel && <HiOutlineCheck />}
										</span>
									</button>
								);
							})}
						</div>
					)}

					{/* Fees — network fee only (no processing fee / VAT). */}
					<div className="mt-8 space-y-3 border-t border-[#eee] pt-4 text-sm">
						<div className="flex items-center justify-between text-muted-foreground">
							<span className="flex items-center gap-2">
								<HiOutlineWallet className="text-base" />
								Network Fee
							</span>
							<span>≈ {NETWORK_FEE_XLM} XLM</span>
						</div>
						<div className="flex items-center justify-between font-medium">
							<span>You withdraw</span>
							<span>
								{(amountNum || 0).toLocaleString()} {selectedCode}
							</span>
						</div>
					</div>

					<Button
						className="mt-6 w-full"
						disabled={!canConfirm}
						onClick={confirm}
					>
						Confirm Withdrawal
					</Button>

					{/* Upcoming contribution — dismissible, matches the design. */}
					{due && !dueDismissed && (
						<section className="relative mt-6 rounded-2xl bg-[#efeaff] p-4 pr-10 md:p-6 md:pr-12">
							<p className="text-sm font-medium">Upcoming Contribution</p>
							<p className="mt-1 text-xs font-light text-muted-foreground md:text-sm">
								Your contribution of{" "}
								<span className="font-medium">
									{Number(due.amount).toLocaleString()} {due.asset_code}
								</span>{" "}
								to “{due.group_name}” is due {dueLabel(due.due_at)}. Ensure you
								leave enough balance to avoid missed payment penalties.
							</p>
							<button
								type="button"
								aria-label="Dismiss"
								onClick={() => setDueDismissed(true)}
								className="absolute right-4 top-4 text-lg text-muted-foreground transition-colors hover:text-foreground"
							>
								<HiOutlineXMark />
							</button>
						</section>
					)}
				</>
			)}

			{showAdd && (
				<AddDestinationModal
					existingCount={savedDests?.length ?? 0}
					onClose={() => setShowAdd(false)}
					onAdded={(id) => {
						setDestId(id);
						setShowAdd(false);
						refetchDests();
					}}
				/>
			)}
		</div>
	);
}

/** Add a withdrawal destination — paste a Stellar address + label. */
function AddDestinationModal({
	existingCount,
	onClose,
	onAdded,
}: {
	existingCount: number;
	onClose: () => void;
	onAdded: (id: number) => void;
}) {
	const [address, setAddress] = useState("");
	const [label, setLabel] = useState("");
	const [saving, setSaving] = useState(false);
	const [err, setErr] = useState("");

	const valid = STELLAR_ADDR.test(address.trim());

	const save = async () => {
		setErr("");
		setSaving(true);
		try {
			const created: WithdrawDestination = await withdrawInfoApi.store({
				stellar_address: address.trim(),
				destination_label: label.trim() || null,
				is_primary: existingCount === 0,
			});
			onAdded(created.id);
		} catch (e) {
			setErr(
				e instanceof ApiError ? e.message : "Could not save that address.",
			);
			setSaving(false);
		}
	};

	return (
		<div className="fixed inset-0 z-[1002] flex items-center justify-center bg-black/40 p-4">
			<div className="w-full max-w-sm rounded-2xl bg-white p-5">
				<h3 className="text-lg font-medium">Add destination</h3>
				<p className="mt-1 text-xs font-light text-muted-foreground">
					The Stellar wallet address to withdraw your circle payouts into.
				</p>

				<label className="mt-4 block text-sm font-light">Label (optional)</label>
				<input
					value={label}
					onChange={(e) => setLabel(e.target.value)}
					placeholder="e.g. My Lobstr wallet"
					className="mt-1 w-full rounded-full border border-neutral-light-hover px-4 py-2.5 text-sm outline-none"
				/>

				<label className="mt-3 block text-sm font-light">Stellar address</label>
				<input
					value={address}
					onChange={(e) => setAddress(e.target.value)}
					placeholder="G…"
					spellCheck={false}
					className={`mt-1 w-full rounded-full border px-4 py-2.5 text-sm outline-none ${
						address && !valid ? "border-error-500" : "border-neutral-light-hover"
					}`}
				/>
				{address && !valid && (
					<p className="mt-1 text-xs text-error-500">
						That doesn&apos;t look like a valid Stellar address.
					</p>
				)}
				{err && <p className="mt-2 text-xs text-error-500">{err}</p>}

				<div className="mt-5 flex justify-end gap-2">
					<Button variant="outline" size="sm" onClick={onClose}>
						Cancel
					</Button>
					<Button size="sm" isLoading={saving} disabled={!valid} onClick={save}>
						Save
					</Button>
				</div>
			</div>
		</div>
	);
}
