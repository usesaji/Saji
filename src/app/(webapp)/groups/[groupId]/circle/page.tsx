"use client";

/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { IoIosArrowRoundForward } from "react-icons/io";
import { IoEye, IoEyeOff } from "react-icons/io5";
import { HiXMark } from "react-icons/hi2";
import GoBack from "@/components/dashboard/GoBack";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/hooks/useApi";
import {
	groups as groupsApi,
	contributions as contributionsApi,
	auth,
	ApiError,
} from "@/lib/api";
import { pageRoutes } from "@/config/routes";
import PendingRequests from "@/features/group/PendingRequests";
import { useSavingsContract } from "@/lib/hooks/useSavingsContract";
import { useLiveCircle } from "@/lib/hooks/useLiveCircle";
import { requireToken } from "@/lib/contract/tokens";
import { addTrustline } from "@/lib/wallet";
import { toast } from "@/lib/utils/toast";
import { displayError, errorMessage } from "@/lib/errors";

const AVATAR = "/images/user.jpg";

/** Contribution frequency code → adjective for copy ("daily", "weekly", …). */
function frequencyLabel(frequency: string | undefined): string {
	switch (frequency) {
		case "daily":
			return "daily";
		case "weekly":
			return "weekly";
		case "bi_weekly":
			return "bi-weekly";
		case "monthly":
			return "monthly";
		case "custom":
			return "scheduled";
		default:
			return "regular";
	}
}

/**
 * Per-circle dashboard: the group's pooled savings, payout rotation, and cycle
 * activity — with first-payment onboarding for a brand-new circle. Backed by
 * GET /api/groups/{id}/circle.
 */
export default function CircleDashboardPage() {
	const { groupId } = useParams<{ groupId: string }>();
	const fetcher = useCallback(
		() => groupsApi.circle(Number(groupId)),
		[groupId],
	);
	const { data, loading, error, refetch } = useApi(fetcher, [groupId]);

	// Organizer check (for pending-request actions).
	const { data: me } = useApi(useCallback(() => auth.me(), []), []);
	const groupFetcher = useCallback(() => groupsApi.show(Number(groupId)), [groupId]);
	const { data: group } = useApi(groupFetcher, [groupId]);
	const isOrganizer = !!(me && group && me.id === group.organizer_id);

	const [hidden, setHidden] = useState(false);
	// Onboarding modal step: 0 = closed, 1 = "alerted 72h", 2 = "payout time".
	// Shown ONCE per circle (persisted in localStorage), not on every visit.
	const onboardKey = `saji:onboarded:circle:${groupId}`;
	const [onboard, setOnboard] = useState(0);

	// On mount, open the onboarding once if this circle hasn't been seen yet.
	useEffect(() => {
		if (typeof window === "undefined") return;
		if (!localStorage.getItem(onboardKey)) {
			setOnboard(1);
		}
	}, [onboardKey]);

	// Mark this circle's onboarding as seen so it never reopens.
	const dismissOnboard = useCallback(() => {
		if (typeof window !== "undefined") {
			localStorage.setItem(onboardKey, "1");
		}
		setOnboard(0);
	}, [onboardKey]);

	const hasActivity = (data?.cycle_activity.length ?? 0) > 0;

	// Contribute here rather than linking to the group page: once the cycle is
	// active that page redirects straight back here, so a link would look like
	// a dead button.
	const { contribute: contributeOnchain } = useSavingsContract();
	const [contributing, setContributing] = useState(false);

	const onchainId = group?.onchain_group_id ?? null;
	const assetCode = data?.group.asset_code ?? "USDC";

	// LIVE on-chain snapshot — read straight from the RPC so state (status, cycle,
	// whether I've paid, my claimable) updates INSTANTLY after an action, without
	// waiting for the backend indexer. Overlaid on the DB data below; refreshed
	// right after contribute/claim.
	const { live, refresh: refreshLive } = useLiveCircle(onchainId);

	// Prefer live chain truth where we have it, fall back to the DB payload.
	// Live status 3 = Completed.
	const isCompleted = live
		? live.status === 3
		: data?.group.status === "completed";
	const currentCycle = live?.cycle ?? data?.current_cycle ?? 0;

	// This cycle's recipient (from the DB rotation, indexed by the live cycle).
	const currentRecipient = data?.payout_rotation.find(
		(m) => !m.removed && m.position - 1 === currentCycle,
	);
	const currentRecipientIsMe =
		!!me && !!currentRecipient && currentRecipient.user_id === me.id;

	// Has the current user paid THIS cycle? Live read wins; DB is the fallback.
	const paidThisCycle = live ? live.paidThisCycle : !!data?.you_paid_this_cycle;

	const contribute = async () => {
		if (!group) return;

		if (onchainId === null || onchainId === undefined) {
			toast.error(
				"This circle isn't live on-chain yet. The organizer must activate it first.",
				"Not ready",
			);
			return;
		}

		setContributing(true);
		try {
			// The wallet must trust the group's token before it can send it. Add
			// the trustline for the GROUP'S chosen asset up front (one signature,
			// no-op if it already trusts it) so the contribution can't fail for a
			// missing trustline — the asset is picked at group creation, not here.
			const linked = me?.stellar_address ?? null;
			const asset = requireToken(assetCode);
			if (linked && !asset.native && asset.issuer) {
				await addTrustline(linked, asset.code, asset.issuer);
			}

			// Record intent (idempotent), settle on-chain, then confirm the row.
			await contributionsApi.store(group.id);
			await contributeOnchain(onchainId);
			await contributionsApi.confirm(group.id).catch(() => {});
			toast.success("Your contribution is on-chain.", "Contribution sent");
			// Read the chain directly for an INSTANT UI update (paid-this-cycle,
			// pool, cycle) — no waiting on the backend indexer.
			refreshLive();
			refetch();
			// The DB-derived bits (activity feed) still reconcile in a standalone
			// process, so refetch once more shortly to pull those in.
			setTimeout(() => refetch(), 6000);
		} catch (err) {
			// See errorMessage: a non-Error throw must not collapse to "" and
			// bypass the specific guidance below.
			const raw = errorMessage(err);

			if (/trustline entry is missing|no trust/i.test(raw)) {
				toast.error(
					`Your wallet can't hold ${assetCode} yet — approve the ${assetCode} trustline when your wallet prompts, then try again.`,
					"Enable the asset first",
				);
			} else if (/#8\b|AlreadyContributed/i.test(raw)) {
				toast.success(
					"You've already contributed this cycle.",
					"Already contributed",
				);
			} else if (/User (declined|rejected)|cancell?ed/i.test(raw)) {
				toast.error("You cancelled the signature.", "Cancelled");
			} else if (/insufficient|balance/i.test(raw)) {
				toast.error(
					`Not enough ${assetCode} in your wallet to contribute.`,
					"Insufficient balance",
				);
			} else {
				toast.error(
					err instanceof ApiError
						? err.message
						: displayError(err, "Something went wrong."),
					"Could not contribute",
				);
			}
		} finally {
			setContributing(false);
		}
	};

	return (
		<div className="mx-auto max-w-3xl pb-10">
			<GoBack />

			{loading && (
				<p className="mt-6 text-sm text-muted-foreground">Loading circle…</p>
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
					{/* Total Group Savings (the pool) */}
					<div className="mt-4 rounded-[20px] bg-primary p-5 text-white md:p-6">
						<div className="flex items-start justify-between gap-4">
							<div className="min-w-0">
								<p className="text-[10px] md:text-sm">Total Group Savings</p>
								<div className="mt-1 flex items-center gap-2.5">
									<h3 className="text-[32px] font-medium md:text-[44px]">
										{hidden
											? "*******"
											: `${Number(data.total_deposited).toLocaleString()} ${data.group.asset_code}`}
									</h3>
									<button
										type="button"
										onClick={() => setHidden((h) => !h)}
										className="text-xl"
										tabIndex={-1}
									>
										{hidden ? <IoEyeOff /> : <IoEye />}
									</button>
								</div>
							</div>
							<div className="h-8 shrink-0">
								<img src="/images/review-user-imgs.png" alt="" className="h-full" />
							</div>
						</div>
						<div className="mt-6">
							<div className="flex items-center justify-between text-[10px] md:text-xs">
								<span>Circle Progress</span>
								<span>{data.circle_progress.percent}%</span>
							</div>
							<div className="mt-1.5 h-1.5 rounded-full bg-primary-dark">
								<div
									className="h-1.5 rounded-full bg-white transition-all"
									style={{ width: `${data.circle_progress.percent}%` }}
								/>
							</div>
						</div>
					</div>

					{/* Payout Rotation */}
					<section className="mt-8">
						<div className="flex items-center justify-between">
							<h4 className="md:text-lg">Payout Rotation</h4>
							<Link
								href={pageRoutes.dashboardRoutes.PAYOUT_ORDER(groupId)}
								className="flex items-center text-xs md:text-sm"
							>
								View All <IoIosArrowRoundForward className="text-lg md:text-2xl" />
							</Link>
						</div>
						{data.payout_rotation.length === 0 ? (
							<p className="mt-4 text-sm text-muted-foreground">
								No rotation yet — start the cycle to set the payout order.
							</p>
						) : (
							<div className="mt-4 flex gap-5 overflow-x-auto hide-scroll pb-2">
								{data.payout_rotation.map((m) => {
									const isCurrent =
										!m.removed && m.position - 1 === data.current_cycle;
									return (
										<div
											key={m.user_id}
											className="flex w-16 shrink-0 flex-col items-center text-center"
										>
											<div
												className={`relative h-14 w-14 overflow-hidden rounded-full bg-[#f0ecff] ${
													m.removed ? "opacity-40 grayscale" : ""
												}`}
											>
												<img
													src={AVATAR}
													alt={m.name ?? "member"}
													className="h-full w-full object-cover"
												/>
												{isCurrent && (
													<span className="absolute -right-1 -top-1 h-4 w-4 rounded-full bg-primary ring-2 ring-white" />
												)}
											</div>
											<p
												className={`mt-1 w-full truncate text-xs font-medium ${
													m.removed ? "text-muted-foreground line-through" : ""
												}`}
											>
												{m.name ?? "Member"}
											</p>
											<p className="text-[10px] text-muted-foreground">
												{m.removed
													? "Removed"
													: isCurrent
														? "Current"
														: "Next Cycle"}
											</p>
										</div>
									);
								})}
							</div>
						)}
					</section>

					{/* Cycle Activity */}
					<section className="mt-8">
						<h4 className="md:text-lg">Cycle Activity</h4>
						{!hasActivity ? (
							<div className="mt-8 flex flex-col items-center py-10 text-center text-muted-foreground">
								<div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#f0f0f0] text-xl">
									i
								</div>
								<p className="mt-3 text-sm">No Activity yet</p>
							</div>
						) : (
							<ul className="mt-4 space-y-2">
								{data.cycle_activity.map((a) => (
									<li
										key={a.id}
										className="flex items-center justify-between rounded-xl bg-[#f8f8f8] px-4 py-3"
									>
										<div>
											<p className="text-sm font-medium capitalize">
												{a.type.replace("_", " ")}
											</p>
											<p className="text-xs text-muted-foreground">
												{new Date(a.created_at).toLocaleString()}
											</p>
										</div>
										{a.explorer_url && (
											<a
												href={a.explorer_url}
												target="_blank"
												rel="noreferrer"
												className="text-xs text-primary underline"
											>
												View Transaction
											</a>
										)}
									</li>
								))}
							</ul>
						)}
					</section>

					{/* Pending join requests (organizer only) — inline, capped, with
					    a View All to the full Requests page. */}
					<PendingRequests
						groupId={Number(groupId)}
						isOrganizer={isOrganizer}
						limit={2}
						showViewAll
					/>

					{/* How this circle works: each cycle earmarks the pool for one
					    member. The contract is PULL-BASED — the money stays escrowed
					    until that member claims it from their Saji Balance, so there IS
					    a withdraw step, just not on this page. This panel makes the
					    current state legible (whose turn, which cycle, whether you've
					    paid). */}
					{!isCompleted && (
						<section className="mt-8 rounded-2xl bg-[#f7f7f7] p-4 md:p-6">
							<div className="flex items-center justify-between">
								<h4 className="md:text-lg">This cycle</h4>
								<span className="text-xs text-muted-foreground">
									Cycle {data.circle_progress.cycles_done + 1} of{" "}
									{data.circle_progress.cycles_total}
								</span>
							</div>
							{currentRecipient ? (
								<p className="mt-2 text-sm">
									<span className="font-medium">{currentRecipient.name ?? "A member"}</span>{" "}
									{currentRecipientIsMe ? "(you) " : ""}receives this cycle&apos;s
									payout once everyone has contributed.
								</p>
							) : (
								<p className="mt-2 text-sm text-muted-foreground">
									The next recipient is set by the payout order.
								</p>
							)}
							<p className="mt-2 text-xs font-light text-muted-foreground">
								When everyone has paid this cycle, the pool is earmarked for the
								member whose turn it is. It then shows in their Saji Balance —
								they approve one transaction to move it to their wallet.
							</p>
						</section>
					)}

					{/* Contribute — runs here directly (the group page redirects back
					    to this one once the cycle is active, so a link would dead-end). */}
					<div className="mt-6">
						<Button
							onClick={contribute}
							isLoading={contributing}
							disabled={paidThisCycle}
							className="w-full md:w-auto"
						>
							{paidThisCycle
								? "You've paid this cycle"
								: hasActivity
									? "Make a Payment"
									: "Make First Payment"}
						</Button>
						{paidThisCycle && (
							<p className="mt-2 text-xs font-light text-muted-foreground">
								You&apos;re paid up for this cycle. Once everyone else has
								contributed, the payout is earmarked for this cycle&apos;s
								recipient, who claims it from their Saji Balance.
							</p>
						)}
					</div>

					{/* Organizer: a way back to the group page (invite link, member
					    list, settings). The group page redirects here once the cycle
					    is active, so this is the organizer's route back to it. */}
					{isOrganizer && (
						<div className="mt-4">
							<Link
								href={`${pageRoutes.dashboardRoutes.GROUP(String(groupId))}?manage=1`}
								className="text-sm font-medium text-primary underline"
							>
								Manage circle & invite link
							</Link>
						</div>
					)}

					{/* Rotation finished → surface the celebration screen. */}
					{isCompleted && (
						<div className="mt-6">
							<Button
								variant="outline"
								href={pageRoutes.dashboardRoutes.GROUP_COMPLETE(groupId)}
								className="w-full md:w-auto"
							>
								View Cycle Summary
							</Button>
						</div>
					)}

					{/* "Make a deposit" nudge banner (new circle, no activity). */}
					{!hasActivity && (
						<div className="mt-6 rounded-2xl bg-primary p-4 text-white">
							<p className="text-sm font-medium">
								Yooo — make a deposit, let&apos;s get started
							</p>
							<p className="text-xs font-light">
								Your {frequencyLabel(data.group.contribution_frequency)}{" "}
								contribution of{" "}
								{Number(data.group.contribution_amount).toLocaleString()}{" "}
								{data.group.asset_code} keeps the circle moving. Fund your wallet
								to avoid a late penalty.
							</p>
						</div>
					)}
				</>
			)}

			{/* Onboarding modals — only while the circle is brand-new. */}
			{data && !loading && !hasActivity && onboard > 0 && (
				<OnboardingModal
					step={onboard}
					onNext={() => (onboard === 1 ? setOnboard(2) : dismissOnboard())}
					onPrev={() => setOnboard(1)}
					onClose={dismissOnboard}
				/>
			)}
		</div>
	);
}

function OnboardingModal({
	step,
	onNext,
	onPrev,
	onClose,
}: {
	step: number;
	onNext: () => void;
	onPrev: () => void;
	onClose: () => void;
}) {
	const content =
		step === 1
			? {
					title: "You get alerted 72 hours before",
					body: "We remind you before each contribution is due so you can keep enough balance and avoid missed-payment penalties.",
				}
			: {
					title: "Payout takes 3–5 minutes",
					body: "Once everyone has contributed, the payout settles on-chain in a few minutes to the member whose turn it is.",
				};

	return (
		<div className="fixed inset-0 z-[1002] flex items-center justify-center bg-black/40 p-4">
			<div className="w-full max-w-sm rounded-2xl bg-white p-5">
				<div className="flex justify-end">
					<button onClick={onClose} type="button" className="text-lg">
						<HiXMark />
					</button>
				</div>
				<h3 className="text-lg font-medium">{content.title}</h3>
				<p className="mt-2 text-sm text-muted-foreground">{content.body}</p>
				<div className="mt-5 flex justify-end gap-2">
					{step === 2 && (
						<Button variant="outline" size="sm" onClick={onPrev}>
							Previous
						</Button>
					)}
					<Button size="sm" onClick={onNext}>
						{step === 1 ? "Next" : "Got it"}
					</Button>
				</div>
			</div>
		</div>
	);
}
