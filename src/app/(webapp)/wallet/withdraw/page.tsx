"use client";

import { useCallback, useMemo, useState } from "react";
import {
	HiOutlineCheck,
	HiOutlineExclamationTriangle,
	HiOutlineWallet,
} from "react-icons/hi2";
import { IoAddOutline } from "react-icons/io5";
import GoBack from "@/components/dashboard/GoBack";
import { Button } from "@/components/ui/button";
import {
	wallet as walletApi,
	withdrawInfo as withdrawInfoApi,
	profile as profileApi,
	type WithdrawDestination,
	ApiError,
} from "@/lib/api";
import { useSavingsContract } from "@/lib/hooks/useSavingsContract";
import { useApi } from "@/lib/hooks/useApi";
import { useSajiBalance } from "@/lib/hooks/useSajiBalance";
import { currentAddress, hasTrustline } from "@/lib/wallet";
import { requireToken } from "@/lib/contract/tokens";
import { formatStroops, fromStroops } from "@/lib/stroops";
import { pageRoutes } from "@/config/routes";
import { BAD_AUTH_MESSAGE, isBadAuthError } from "@/lib/errors";

const STELLAR_ADDR = /^G[A-Z2-7]{55}$/;

type Phase = "form" | "processing" | "done";

/** One circle's ready payout, flattened out of the per-asset balance. */
type Claimable = {
	key: string;
	onchainGroupId: number;
	groupName: string;
	assetCode: string;
	amount: bigint;
};

type Outcome = {
	claimed: { groupName: string; assetCode: string; amount: bigint }[];
	failed: { groupName: string; reason: string }[];
};

/**
 * Withdraw — ONE action: a payout goes straight from the contract to an address
 * you name.
 *
 * This screen used to merge two opposite movements behind one button: claiming
 * escrowed money (which arrives) and sending wallet money onward (which leaves).
 * "Available" summed both, so withdrawing an amount your wallet already covered
 * skipped the claim entirely and sent your OWN funds out — the balance went
 * DOWN on a screen you pressed expecting a payout. The claim/send split is gone:
 * this screen only ever releases escrow, and your wallet can only go up.
 *
 * Granularity is PER CIRCLE, not per amount, because `claim_payout` takes no
 * amount — a circle's payout is released in full or not at all. The old amount
 * box could not honour a partial request: it released everything and forwarded
 * you a slice, leaving the rest loose in your wallet.
 *
 * Non-custodial throughout — the contract holds the funds, you sign, and you
 * alone choose where they land.
 */
export default function WithdrawPage() {
	const { claimPayout } = useSavingsContract();
	const { data: me } = useApi(useCallback(() => profileApi.show(), []), []);
	const { assets, loading, error: balanceError, refresh } = useSajiBalance();

	const { data: savedDests, refetch: refetchDests } = useApi(
		useCallback(() => withdrawInfoApi.index(), []),
		[],
	);

	// Every ready payout across every circle and asset, in one list.
	const claimables = useMemo<Claimable[]>(
		() =>
			assets.flatMap((asset) =>
				asset.claimables.map((c) => ({
					key: `${c.onchain_group_id}`,
					onchainGroupId: c.onchain_group_id,
					groupName: c.group_name,
					assetCode: asset.asset_code,
					amount: c.amount,
				})),
			),
		[assets],
	);

	// Everything selected by default — taking all of it is the common case.
	// `null` means "not touched yet", so newly-arrived payouts are included
	// rather than silently left out of a stale selection.
	const [deselected, setDeselected] = useState<Set<string>>(new Set());
	const chosen = claimables.filter((c) => !deselected.has(c.key));

	const [destId, setDestId] = useState<number | null>(null);
	const [showAdd, setShowAdd] = useState(false);
	const [phase, setPhase] = useState<Phase>("form");
	const [errorMsg, setErrorMsg] = useState("");
	const [outcome, setOutcome] = useState<Outcome>({ claimed: [], failed: [] });
	const [ledgerWarning, setLedgerWarning] = useState("");

	const dest =
		savedDests?.find((d) => d.id === destId) ??
		savedDests?.find((d) => d.is_primary) ??
		savedDests?.[0] ??
		null;

	// Totals PER ASSET. A user can hold payouts in XLM and USDC at once, and
	// adding those into one figure would be meaningless.
	const totals = useMemo(() => {
		const byAsset = new Map<string, bigint>();
		for (const c of chosen) {
			byAsset.set(c.assetCode, (byAsset.get(c.assetCode) ?? 0n) + c.amount);
		}
		return [...byAsset.entries()];
	}, [chosen]);

	const canConfirm = chosen.length > 0 && !!dest && phase === "form";

	const toggle = (key: string) =>
		setDeselected((current) => {
			const next = new Set(current);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});

	/**
	 * Record a released payout in Saji's ledger.
	 *
	 * The money has ALREADY moved on-chain by the time this runs, so a silent
	 * failure leaves history missing a real transfer. Retried once, then
	 * surfaced as a warning — never as a failure, because the funds moved either
	 * way and saying otherwise would be false.
	 */
	const logSafely = async (entry: {
		hash: string | null;
		amount: bigint;
		assetCode: string;
	}) => {
		const payload = {
			tx_hash: entry.hash ?? undefined,
			amount: fromStroops(entry.amount),
			asset_code: entry.assetCode,
		};
		try {
			await walletApi.logWithdrawal(payload);
		} catch {
			try {
				await walletApi.logWithdrawal(payload);
			} catch {
				setLedgerWarning(
					"Your payout was released on-chain, but we couldn't record it in your history. The money has moved — only the record is missing.",
				);
			}
		}
	};

	const confirm = async () => {
		if (!dest || chosen.length === 0) return;
		setErrorMsg("");
		setLedgerWarning("");
		setPhase("processing");

		const to = dest.stellar_address;

		try {
			const from = me?.stellar_address ?? (await currentAddress()) ?? null;
			if (!from) {
				throw new Error(
					"No wallet address on your account yet — add one in your profile to receive payouts.",
				);
			}

			// The contract pays the DESTINATION directly, so it is the destination
			// that must be able to hold each asset. Checked once per distinct
			// asset, before signing anything — a missing trustline makes the claim
			// revert, which wastes a signature and confuses the user.
			for (const code of new Set(chosen.map((c) => c.assetCode))) {
				const token = requireToken(code);
				if (!token.native && token.issuer) {
					if (!(await hasTrustline(to, token.code, token.issuer))) {
						throw new Error(
							`That destination can't receive ${code} yet. It needs a ${code} trustline before you can withdraw to it.`,
						);
					}
				}
			}

			// One claim per circle — each holds its own escrow slot, so there is no
			// way to collapse these into a single signature.
			//
			// Each success is logged AS IT HAPPENS rather than after the loop. A
			// circle that fails midway must not erase the record of the ones that
			// already moved: that money is irreversibly at the destination.
			const claimed: Outcome["claimed"] = [];
			const failed: Outcome["failed"] = [];

			for (const c of chosen) {
				try {
					const { amount, hash } = await claimPayout(c.onchainGroupId, to);
					claimed.push({
						groupName: c.groupName,
						assetCode: c.assetCode,
						amount,
					});
					await logSafely({ hash, amount, assetCode: c.assetCode });
				} catch (err) {
					failed.push({ groupName: c.groupName, reason: describe(err) });
				}
			}

			setOutcome({ claimed, failed });
			setPhase("done");
			refresh();
		} catch (err) {
			// Only pre-flight failures reach here (no wallet, no trustline) — the
			// per-circle loop handles its own. Nothing has moved at this point.
			setErrorMsg(describe(err));
			setOutcome({ claimed: [], failed: [] });
			setPhase("done");
			refresh();
		}
	};

	// ---- Result ----
	if (phase === "processing" || phase === "done") {
		const { claimed, failed } = outcome;
		const nothingMoved = claimed.length === 0;

		return (
			<div className="mx-auto max-w-lg pb-10">
				<GoBack />
				<div className="py-16 text-center">
					{phase === "processing" ? (
						<>
							<div className="mx-auto h-16 w-16 animate-spin rounded-full border-4 border-primary border-t-transparent" />
							<h2 className="mt-6 text-xl font-medium">Releasing your payout</h2>
							<p className="mt-2 text-sm text-muted-foreground">
								Approve each circle when your wallet prompts — one approval per
								circle.
							</p>
						</>
					) : (
						<>
							<div
								className={`mx-auto flex h-24 w-24 items-center justify-center rounded-full text-white ${
									nothingMoved ? "bg-error-500" : "bg-primary"
								}`}
							>
								{nothingMoved ? (
									<HiOutlineExclamationTriangle className="text-5xl" />
								) : (
									<HiOutlineCheck className="text-5xl" />
								)}
							</div>

							<h2 className="mt-6 text-xl font-medium">
								{nothingMoved
									? "Nothing was withdrawn"
									: failed.length > 0
										? "Partly withdrawn"
										: "Withdrawal complete"}
							</h2>

							{/* What actually moved, named per circle. Every line here is a
							    transfer that has already settled on-chain. */}
							{claimed.length > 0 && (
								<div className="mt-3 space-y-1 text-sm">
									{claimed.map((c, i) => (
										<p key={i} className="text-muted-foreground">
											<span className="font-medium text-foreground">
												{formatStroops(c.amount)} {c.assetCode}
											</span>{" "}
											sent from {c.groupName}
										</p>
									))}
								</div>
							)}

							{errorMsg && (
								<p className="mt-3 text-sm text-muted-foreground">{errorMsg}</p>
							)}

							{/* Anything that did NOT move is still escrowed and still
							    claimable — say so plainly rather than implying a loss. */}
							{failed.length > 0 && (
								<div className="mt-4 rounded-2xl bg-[#fff4f4] p-4 text-left text-xs">
									<p className="font-medium">
										Still waiting — nothing was lost:
									</p>
									{failed.map((f, i) => (
										<p key={i} className="mt-1 text-muted-foreground">
											<span className="font-medium">{f.groupName}</span> —{" "}
											{f.reason}
										</p>
									))}
									<p className="mt-2 text-muted-foreground">
										These payouts are still held by the contract. Try again
										whenever you like.
									</p>
								</div>
							)}

							{ledgerWarning && (
								<p className="mt-3 text-xs text-warning-800">{ledgerWarning}</p>
							)}

							<div className="mt-6 flex flex-col gap-2">
								{failed.length > 0 && (
									<button
										onClick={() => {
											setPhase("form");
											setOutcome({ claimed: [], failed: [] });
										}}
										className="font-medium underline"
									>
										Try again
									</button>
								)}
								<Button href={pageRoutes.dashboardRoutes.WALLET}>
									Back to Wallet
								</Button>
							</div>
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
			<p className="mt-1 text-sm font-light text-muted-foreground">
				Your payout goes straight from the circle to the address you choose.
			</p>

			{loading ? (
				<p className="mt-6 text-sm text-muted-foreground">Loading…</p>
			) : balanceError ? (
				/* A failed read must NOT look like an empty balance — that would tell
				   a user with a real payout that their money is gone. */
				<div className="mt-4 rounded-2xl bg-[#fff4f4] p-6 text-center text-sm">
					<p className="text-error-500">{balanceError}</p>
					<p className="mt-1 text-xs text-muted-foreground">
						Your funds are safe on-chain — we just couldn&apos;t read them.
					</p>
					<button onClick={refresh} className="mt-3 font-medium underline">
						Try again
					</button>
				</div>
			) : claimables.length === 0 ? (
				<div className="mt-4 rounded-2xl bg-[#f7f7f7] p-6 text-center text-sm text-muted-foreground">
					No payouts ready yet. When a circle pays you, it shows up here.
				</div>
			) : (
				<>
					{/* Ready payouts — one row per circle, because that is the unit the
					    contract releases in. */}
					<h3 className="mt-6 text-base font-medium">Ready to withdraw</h3>
					<div className="mt-3 space-y-2">
						{claimables.map((c) => {
							const on = !deselected.has(c.key);
							return (
								<button
									key={c.key}
									type="button"
									role="checkbox"
									aria-checked={on}
									onClick={() => toggle(c.key)}
									className={`flex w-full items-center justify-between gap-3 rounded-2xl border p-4 text-left transition-colors ${
										on
											? "border-primary bg-[#efeaff]"
											: "border-[#eee] bg-[#f8f8f8] hover:bg-[#f0f0f0]"
									}`}
								>
									<span className="flex min-w-0 items-center gap-3">
										<span
											className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-xs ${
												on
													? "bg-primary text-white"
													: "border border-neutral-light-hover"
											}`}
										>
											{on && <HiOutlineCheck />}
										</span>
										<span className="min-w-0 truncate text-sm font-medium">
											{c.groupName}
										</span>
									</span>
									<span className="shrink-0 text-sm font-medium">
										{formatStroops(c.amount)} {c.assetCode}
									</span>
								</button>
							);
						})}
					</div>

					{/* Destination */}
					<div className="mt-8 flex items-center justify-between">
						<h3 className="text-base font-medium">Send to</h3>
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
							<IoAddOutline className="text-lg" /> Add the wallet address to
							receive your payout
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

					{/* Summary. Per asset, never summed across them. */}
					<div className="mt-8 border-t border-[#eee] pt-4 text-sm">
						<div className="flex items-start justify-between gap-3">
							<span className="text-muted-foreground">You receive</span>
							<span className="text-right font-medium">
								{totals.length === 0
									? "—"
									: totals.map(([code, amount]) => (
											<span key={code} className="block">
												{formatStroops(amount)} {code}
											</span>
										))}
							</span>
						</div>
						{chosen.length > 1 && (
							<p className="mt-2 text-xs font-light text-muted-foreground">
								{chosen.length} circles — your wallet will ask you to approve
								each one separately.
							</p>
						)}
					</div>

					<Button className="mt-6 w-full" disabled={!canConfirm} onClick={confirm}>
						Withdraw
					</Button>
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

/** Turn a thrown value into something a person can act on. */
function describe(err: unknown): string {
	const raw = err instanceof Error ? err.message : "";
	if (/User (declined|rejected)|cancell?ed/i.test(raw)) {
		return "You cancelled the signature.";
	}
	if (/trustline entry is missing|no trust/i.test(raw)) {
		return "That destination can't hold this asset yet — it needs a trustline first.";
	}
	// NothingToClaim: the payout was already taken, most likely in another tab.
	if (/#16\b|NothingToClaim/i.test(raw)) {
		return "This payout has already been withdrawn.";
	}
	if (isBadAuthError(err)) return BAD_AUTH_MESSAGE;
	if (err instanceof ApiError) return err.message;
	return raw || "Something went wrong.";
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
			setErr(e instanceof ApiError ? e.message : "Could not save that address.");
			setSaving(false);
		}
	};

	return (
		<div className="fixed inset-0 z-[1002] flex items-center justify-center bg-black/40 p-4">
			<div className="w-full max-w-sm rounded-2xl bg-white p-5">
				<h3 className="text-lg font-medium">Add destination</h3>
				<p className="mt-1 text-xs font-light text-muted-foreground">
					The Stellar wallet address to receive your circle payouts. Usually your
					own wallet.
				</p>

				<label className="mt-4 block text-sm font-light">Label (optional)</label>
				<input
					value={label}
					onChange={(e) => setLabel(e.target.value)}
					placeholder="e.g. My Freighter wallet"
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
