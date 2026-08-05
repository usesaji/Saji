"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import GroupPreview from "@/features/group/GroupPreview";
import InviteLink from "@/features/group/InviteLink";
import GoBack from "@/components/dashboard/GoBack";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/hooks/useApi";
import {
	groups as groupsApi,
	contributions as contributionsApi,
	auth,
	assetUrl,
	ApiError,
} from "@/lib/api";
import { groupToCircle, labelize } from "@/features/group/group-view";
import { pageRoutes } from "@/config/routes";
import { useSavingsContract } from "@/lib/hooks/useSavingsContract";
import { tokenFor } from "@/lib/contract/tokens";
import { addTrustline } from "@/lib/wallet";
import { toast } from "@/lib/utils/toast";

/** Contribution frequency → cycle length in days (for the on-chain create). */
function cycleDaysFor(frequency: string | undefined): number {
	switch (frequency) {
		case "daily":
			return 1;
		case "weekly":
			return 7;
		case "bi_weekly":
			return 14;
		case "monthly":
			return 30;
		default:
			return 7;
	}
}

export default function GroupPreviewPage() {
	// Auth token lives in localStorage, so the fetch must run client-side; read
	// the dynamic segment with useParams rather than a server `params` prop.
	const { groupId } = useParams<{ groupId: string }>();
	const router = useRouter();
	const searchParams = useSearchParams();
	// The organizer can open this page explicitly (?manage=1) to see the invite
	// link / member list even after the cycle is live, without being bounced to
	// the circle view by the auto-redirect below.
	const manageMode = searchParams.get("manage") === "1";

	const fetcher = useCallback(
		() => groupsApi.show(Number(groupId)),
		[groupId],
	);
	const { data, loading, error, refetch } = useApi(fetcher, [groupId]);

	// Real per-circle totals (member count, pooled). Separate call so base info
	// still renders if this fails.
	const circleFetcher = useCallback(
		() => groupsApi.circle(Number(groupId)),
		[groupId],
	);
	const { data: circle } = useApi(circleFetcher, [groupId]);

	// Only the organizer may change the group banner (backend enforces this too).
	const meFetcher = useCallback(() => auth.me(), []);
	const { data: me } = useApi(meFetcher, []);
	const isOrganizer = !!(me && data && me.id === data.organizer_id);

	// Contributing is for APPROVED members only. Anyone can open a group page
	// (e.g. straight off an invite link), so gate the action on membership
	// rather than showing a button that is guaranteed to fail.
	const myMembership = me
		? (data?.members ?? []).find((m) => m.user_id === me.id)
		: undefined;
	const isApprovedMember = myMembership?.status === "approved";
	const isPendingMember = myMembership?.status === "pending";

	// Contribute this cycle by calling the contract DIRECTLY (wallet signs
	// client-side). Records intent in the DB, then settles on-chain.
	const {
		createGroup: createGroupOnchain,
		contribute: contributeOnchain,
		joinGroup: joinGroupOnchain,
		startCycle: startCycleOnchain,
		resolveDefault: resolveDefaultOnchain,
		getOnchainState,
	} = useSavingsContract();
	const [contributing, setContributing] = useState(false);
	// Distinct phase so the button can say "Confirm in your wallet…" while the
	// signature prompt is open, instead of a generic spinner the whole time.
	const [signing, setSigning] = useState(false);
	const [admitting, setAdmitting] = useState<number | null>(null);
	const [starting, setStarting] = useState(false);
	const [resolving, setResolving] = useState<number | null>(null);
	const [activating, setActivating] = useState(false);

	const isLive =
		data?.onchain_group_id !== null && data?.onchain_group_id !== undefined;

	// Live on-chain membership + status, so the UI reflects the TRUE chain state
	// (who's admitted, whether the cycle started) instead of guessing.
	const onchainFetcher = useCallback(
		() =>
			isLive
				? getOnchainState(data!.onchain_group_id!)
				: Promise.resolve(null),
		[isLive, data?.onchain_group_id, getOnchainState],
	);
	const { data: chain, refetch: refetchChain } = useApi(onchainFetcher, [
		data?.onchain_group_id,
	]);

	// 2 = Active — once started, no more joins are accepted.
	const cycleStarted = (chain?.status ?? 0) >= 2;

	// The group is "live" (past forming) if EITHER the DB says active/completed
	// (known immediately from the first fetch) OR the chain read confirms it.
	// Using the DB status lets us redirect without waiting for the chain round
	// trip, so the forming view never flashes for an already-active circle.
	const dbLive =
		data?.status === "active" || data?.status === "completed";
	const shouldRedirect = (dbLive || cycleStarted) && !manageMode;

	// Once the cycle is live, this "forming" preview no longer applies — the
	// active experience lives on the circle view. Send members there.
	useEffect(() => {
		if (shouldRedirect) {
			router.replace(pageRoutes.dashboardRoutes.CIRCLE(groupId));
		}
	}, [shouldRedirect, groupId, router]);
	const onchainMembers = new Set(
		(chain?.members ?? []).map((a) => a.toLowerCase()),
	);
	const isOnchainMember = (address: string | null) =>
		!!address && onchainMembers.has(address.toLowerCase());

	// --- Organizer progress (drives the setup checklist) ---
	// Non-organizer members who still have a pending join request.
	const pendingCount = (data?.members ?? []).filter(
		(m) => m.user_id !== data?.organizer_id && m.status === "pending",
	).length;
	// Members admitted on-chain (the count the contract cares about for start).
	const admittedCount = onchainMembers.size;
	// The contract needs ≥2 members on-chain before a cycle can start.
	const canStart = admittedCount >= 2;

	// Organizer admits a member ON-CHAIN (contract requires the organizer to
	// sign join_group). The member must have a linked wallet.
	const admitOnchain = async (memberUserId: number, address: string) => {
		if (!data || !isLive) return;
		setAdmitting(memberUserId);
		try {
			await joinGroupOnchain(data.onchain_group_id!, address);
			toast.success("Member admitted on-chain.", "Member added");
			refetch();
			refetchChain();
		} catch (err) {
			const msg = err instanceof Error ? err.message : "";
			// #6 = AlreadyMember → already on-chain; #5 = WrongStatus → the cycle
			// already started so joins are closed. Both mean "no action needed".
			if (/#6\b|AlreadyMember/i.test(msg)) {
				toast.success("This member is already on-chain.", "Already admitted");
				refetchChain();
			} else if (/#5\b|WrongStatus/i.test(msg)) {
				toast.error(
					"Joining is closed — the cycle has already started.",
					"Cannot admit",
				);
				refetchChain();
			} else {
				toast.error(msg || "Could not admit member.", "Failed");
			}
		} finally {
			setAdmitting(null);
		}
	};

	// Organizer approves a PENDING join request (DB-level). After this the member
	// is 'approved' and can then be admitted on-chain.
	const approveMember = async (memberId: number) => {
		if (!data) return;
		setAdmitting(memberId);
		try {
			await groupsApi.approve(data.id, memberId);
			toast.success("Member approved.", "Approved");
			refetch();
		} catch (err) {
			toast.error(
				err instanceof ApiError ? err.message : "Could not approve.",
				"Failed",
			);
		} finally {
			setAdmitting(null);
		}
	};

	// Recovery: create the group ON-CHAIN when it was never linked (e.g. the
	// organizer created it with no wallet connected, so the create step was
	// skipped and onchain_group_id stayed null). Runs the same create_group +
	// recordOnchain the create wizard does — but here with real error feedback
	// instead of failing silently. Needs a connected wallet.
	const activateOnchain = async () => {
		if (!data) return;
		setActivating(true);
		try {
			const cycleDays =
				data.contribution_frequency === "custom"
					? data.cycle_length_days || 1
					: undefined;
			const onchainId = await createGroupOnchain({
				token: tokenFor(data.asset_code).sac,
				contributionAmount: data.contribution_amount,
				cycleLengthDays: cycleDays ?? cycleDaysFor(data.contribution_frequency),
				feeBps: data.fee_bps ?? 0,
				lateFeeBps: data.late_fee_bps ?? 0,
				gracePeriodHours: data.grace_period_hours ?? 0,
				payoutOrder: data.payout_order ?? "manual",
				latePenalty: data.late_penalty ?? "deduct_from_balance",
			});
			await groupsApi.recordOnchain(data.id, {
				onchain_group_id: Number(onchainId),
			});
			toast.success(
				"Your circle is now live on-chain. You can admit members and start the cycle.",
				"Circle activated",
			);
			refetch();
			refetchChain();
		} catch (err) {
			const msg = err instanceof Error ? err.message : "";
			if (/Connect your wallet/i.test(msg)) {
				toast.error(
					"Connect your wallet first — activating the circle needs your signature.",
					"Wallet not connected",
				);
			} else if (/User (declined|rejected)|cancell?ed/i.test(msg)) {
				toast.error("You cancelled the signature.", "Cancelled");
			} else {
				toast.error(
					err instanceof ApiError ? err.message : msg || "Could not activate the circle.",
					"Activation failed",
				);
			}
		} finally {
			setActivating(false);
		}
	};

	// Organizer starts the cycle → group becomes Active (needs ≥2 members).
	const startCycle = async () => {
		if (!data || !isLive) return;
		setStarting(true);
		try {
			await startCycleOnchain(data.onchain_group_id!);
			// Sync the DB status to active (no indexer yet).
			await groupsApi.activate(data.id).catch(() => {});
			toast.success("The cycle is live — members can contribute now.", "Cycle started");
			refetch();
			refetchChain();
		} catch (err) {
			const msg = err instanceof Error ? err.message : "";
			// Translate the specific on-chain / wallet failures instead of a
			// generic "could not start" that hides the real cause.
			if (/Connect your wallet/i.test(msg)) {
				toast.error(
					"Connect your wallet first — starting the cycle needs your signature.",
					"Wallet not connected",
				);
			} else if (/User (declined|rejected)|cancell?ed/i.test(msg)) {
				toast.error("You cancelled the signature.", "Cancelled");
			} else if (/#10\b|TooFewMembers/i.test(msg)) {
				toast.error(
					"You need at least 2 members added on-chain before starting.",
					"Too few members",
				);
			} else if (/#5\b|WrongStatus/i.test(msg)) {
				toast.error(
					"This circle isn't in a state that can be started — it may already be active or completed.",
					"Cannot start",
				);
			} else if (/auth|require_auth|signature|not authorized/i.test(msg)) {
				toast.error(
					"Only the organizer's wallet can start the cycle. Make sure the organizer's wallet is connected.",
					"Wrong wallet",
				);
			} else {
				toast.error(msg || "Could not start the cycle.", "Failed");
			}
		} finally {
			setStarting(false);
		}
	};

	// Organizer resolves a member who's missed this cycle past the grace period.
	// The contract decides the outcome (remove+refund vs. late fee); we just
	// surface the result. Organizer signs.
	const resolveDefault = async (memberUserId: number, address: string | null) => {
		if (!data || !isLive) return;
		if (!address) {
			toast.error("This member has no linked wallet to resolve.", "Cannot resolve");
			return;
		}
		setResolving(memberUserId);
		try {
			await resolveDefaultOnchain(data.onchain_group_id!, address);
			toast.success(
				"Resolved on-chain. If their wallet was empty they were removed and refunded; otherwise a late fee was applied.",
				"Default resolved",
			);
			refetch();
			refetchChain();
		} catch (err) {
			const msg = err instanceof Error ? err.message : "";
			// #14 = NotDefaultable → not yet past grace, already paid, or already out.
			if (/#14\b|NotDefaultable/i.test(msg)) {
				toast.error(
					"Not resolvable yet — the member has paid, is already out, or the grace period hasn't elapsed.",
					"Nothing to resolve",
				);
			} else if (/User (declined|rejected)|cancell?ed/i.test(msg)) {
				toast.error("You cancelled the signature.", "Cancelled");
			} else {
				toast.error(msg || "Could not resolve the default.", "Failed");
			}
		} finally {
			setResolving(null);
		}
	};

	const contribute = async () => {
		if (!data) return;

		if (data.onchain_group_id === null || data.onchain_group_id === undefined) {
			toast.error(
				"This group isn't live on-chain yet. The organizer must activate it first.",
				"Not ready",
			);
			return;
		}

		setContributing(true);
		try {
			// Ensure the wallet trusts the GROUP'S token first (chosen at group
			// creation). One signature, no-op if already trusted — so a
			// contribution never fails for a missing trustline.
			const linked = me?.stellar_address ?? null;
			const asset = tokenFor(data.asset_code);
			if (linked && !asset.native && asset.issuer) {
				await addTrustline(linked, asset.code, asset.issuer);
			}

			// Record the intent (idempotent) so it shows in history.
			await contributionsApi.store(data.id);
			// Settle on-chain via the contract bindings (wallet signs). The wallet
			// prompt opens here, so flip to the "signing" phase for clear feedback.
			setSigning(true);
			await contributeOnchain(data.onchain_group_id);
			setSigning(false);
			// Report success so the backend flips the row pending → confirmed
			// (no chain indexer yet).
			await contributionsApi.confirm(data.id).catch(() => {});
			toast.success("Your contribution is on-chain.", "Contribution sent");
			refetch();
		} catch (err) {
			const raw = err instanceof Error ? err.message : "";

			// Translate the common on-chain contribute failures into plain guidance.
			if (/trustline entry is missing|no trust/i.test(raw)) {
				toast.error(
					`Your wallet can't hold ${data.asset_code ?? "USDC"} yet. Add a ${data.asset_code ?? "USDC"} trustline in your wallet, then try again.`,
					"Add a trustline first",
				);
			} else if (/insufficient|balance|#\d*\b.*balance/i.test(raw) && /USDC|trust/i.test(raw)) {
				toast.error(
					`Not enough ${data.asset_code ?? "USDC"} in your wallet to contribute.`,
					"Insufficient balance",
				);
			} else if (/#8\b|AlreadyContributed/i.test(raw)) {
				toast.success(
					"You've already contributed this cycle.",
					"Already contributed",
				);
			} else if (/User (declined|rejected)|cancell?ed/i.test(raw)) {
				toast.error("You cancelled the signature.", "Cancelled");
			} else {
				toast.error(
					err instanceof ApiError ? err.message : raw || "Something went wrong.",
					"Could not contribute",
				);
			}
		} finally {
			setContributing(false);
			setSigning(false);
		}
	};

	// Real group-settings labels come straight off the group payload's raw
	// snake_case fields (more complete than the list adapter's placeholders).
	const real = data
		? {
				memberCount: circle?.member_count ?? data.members_count ?? data.member_count,
				groupType: data.group_type ? labelize(data.group_type) : undefined,
				payoutOrder: data.payout_order ? labelize(data.payout_order) : undefined,
				latePenalty: data.late_penalty ? labelize(data.late_penalty) : undefined,
			}
		: undefined;

	// An active/completed circle lives on the circle view; while the redirect is
	// resolving, show a neutral loader so the "forming" UI never flashes.
	if (shouldRedirect) {
		return (
			<div className="mx-auto max-w-3xl pb-10">
				<GoBack />
				<div className="mt-6 text-center text-sm text-muted-foreground">
					Taking you to your circle…
				</div>
			</div>
		);
	}

	return (
		<div className="mx-auto max-w-3xl pb-10">
			<GoBack />

			{loading && (
				<div className="mt-6 text-center text-sm text-muted-foreground">
					Loading group…
				</div>
			)}

			{error && !loading && (
				<div className="mt-6 text-center text-sm">
					<p className="text-error-500">{error}</p>
					<button onClick={refetch} className="mt-2 font-medium underline">
						Try again
					</button>
				</div>
			)}

			{data && !loading && (
				<GroupPreview
					group={groupToCircle(data)}
					real={real}
					onBannerUpload={
						isOrganizer
							? async (file) => {
									const { photo_url } = await groupsApi.uploadPhoto(
										data.id,
										file,
									);
									refetch();
									return assetUrl(photo_url);
								}
							: undefined
					}
					// Rotating circles are invite-only (no join-by-id), so no Join
					// action is shown here — members enter via an invite link.
				/>
			)}

			{/* Organizer: shareable invite link so others can join. */}
			{data && !loading && isOrganizer && <InviteLink groupId={data.id} />}

			{/* Recovery: group exists in the app but was never created on-chain
			    (e.g. created with no wallet connected). Until it's live, members
			    can't be admitted or the cycle started — so surface a clear way to
			    put it on-chain now, instead of a hidden dead-end. */}
			{data && !loading && isOrganizer && !isLive && (
				<section className="mt-8 rounded-2xl bg-warning-100 p-4 md:p-6">
					<h3 className="md:text-xl">Activate your circle on-chain</h3>
					<p className="mt-1 text-sm font-light text-warning-800">
						This circle isn&apos;t live on the blockchain yet, so you can&apos;t
						admit members or start the cycle. This usually happens when it was
						created without a wallet connected. Connect your wallet and activate
						it now — you&apos;ll sign one transaction.
					</p>
					<Button
						onClick={activateOnchain}
						isLoading={activating}
						className="mt-4 w-full md:w-auto"
					>
						Activate on-chain
					</Button>
				</section>
			)}

			{/* Organizer controls: admit members on-chain + start the cycle. */}
			{data && !loading && isOrganizer && isLive && (
				<section className="mt-8 rounded-2xl bg-[#f7f7f7] p-4 md:p-6">
					<h3 className="md:text-xl">Organizer setup</h3>
					<p className="mt-1 text-xs font-light text-muted-foreground">
						Complete these steps in order to get your circle running.
					</p>

					{/* Setup checklist — shows exactly where the organizer is. */}
					<ol className="mt-4 space-y-2">
						<ChecklistItem
							done={pendingCount === 0}
							label={
								pendingCount === 0
									? "All join requests reviewed"
									: `${pendingCount} join request${pendingCount === 1 ? "" : "s"} awaiting approval`
							}
						/>
						<ChecklistItem
							done={admittedCount >= 2}
							label={`${admittedCount} member${admittedCount === 1 ? "" : "s"} added to the chain${admittedCount < 2 ? " (need at least 2)" : ""}`}
						/>
						<ChecklistItem
							done={false}
							muted
							label="Set the payout order — this locks when you start"
						/>
						<ChecklistItem
							done={cycleStarted}
							label={cycleStarted ? "Cycle started" : "Start the cycle"}
						/>
					</ol>

					<p className="mt-4 text-sm font-medium">Members</p>
					<div className="mt-2 space-y-2">
						{(data.members ?? []).map((m) => {
							const addr = m.user?.stellar_address ?? null;
							const isOrg = m.user_id === data.organizer_id;
							return (
								<div
									key={m.id}
									className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2"
								>
									<div className="min-w-0">
										<p className="text-sm font-medium">
											{m.user?.name ?? "Member"}
											{isOrg && (
												<span className="ml-2 text-xs text-muted-foreground">
													(organizer)
												</span>
											)}
											{!isOrg && m.status === "pending" && (
												<span className="ml-2 rounded-full bg-warning-100 px-2 py-0.5 text-[10px] text-warning-800">
													pending
												</span>
											)}
										</p>
										<p className="truncate text-xs text-muted-foreground">
											{addr ?? "No wallet linked"}
										</p>
									</div>

									{/* Admitting a member is two steps: (1) Approve the join
									    request in the app, then (2) Add them to the chain,
									    which needs your wallet signature. */}
									{isOrg ? null : m.status === "pending" ? (
										<div className="flex shrink-0 flex-col items-end gap-0.5">
											<Button
												size="sm"
												isLoading={admitting === m.id}
												onClick={() => approveMember(m.id)}
											>
												Step 1 · Approve
											</Button>
											<span className="text-[10px] text-muted-foreground">
												then add to chain
											</span>
										</div>
									) : isOnchainMember(addr) ? (
										<div className="flex shrink-0 items-center gap-2">
											<span className="rounded-full bg-success-50 px-3 py-1 text-xs text-success-700">
												✓ On-chain
											</span>
											{/* Once the cycle is live, the organizer can resolve a
											    member who's missed it past the grace period. The
											    contract enforces the deadline + outcome; this button
											    just triggers it. Not shown for the organizer's own row. */}
											{cycleStarted && (
												<Button
													size="sm"
													variant="outline"
													isLoading={resolving === m.user_id}
													onClick={() => resolveDefault(m.user_id, addr)}
												>
													Resolve default
												</Button>
											)}
										</div>
									) : !addr ? (
										<span className="shrink-0 text-xs text-muted-foreground">
											Waiting for their wallet
										</span>
									) : cycleStarted ? (
										<span className="shrink-0 text-xs text-muted-foreground">
											Joining closed
										</span>
									) : (
										<Button
											size="sm"
											variant="outline"
											isLoading={admitting === m.user_id}
											onClick={() => admitOnchain(m.user_id, addr)}
										>
											Step 2 · Add to chain
										</Button>
									)}
								</div>
							);
						})}
					</div>

					{cycleStarted ? (
						<p className="mt-4 rounded-xl bg-success-50 px-3 py-2 text-sm text-success-700">
							The cycle is live — members can contribute.
						</p>
					) : (
						<div className="mt-4">
							<div className="flex flex-col gap-3 md:flex-row">
								{/* Set the rotation BEFORE starting — start_cycle locks it. */}
								<Button
									variant="outline"
									href={pageRoutes.dashboardRoutes.PAYOUT_ORDER(data.id)}
									className="w-full md:w-auto"
								>
									Set Payout Order
								</Button>
								<Button
									onClick={startCycle}
									isLoading={starting}
									disabled={!canStart}
									title={
										canStart
											? undefined
											: "Add at least 2 members to the chain first"
									}
									className="w-full md:w-auto"
								>
									Start Cycle
								</Button>
							</div>
							{!canStart && (
								<p className="mt-2 text-xs font-light text-muted-foreground">
									Set the payout order first (it locks once the cycle starts),
									then start once at least 2 members are on the chain.
								</p>
							)}
						</div>
					)}
				</section>
			)}

			{/* Contribute — only for approved members, and only once the cycle is
			    actually live. Everyone else gets an explanation instead of a
			    button that would fail. */}
			{data && !loading && (
				<div id="contribute" className="mt-6 scroll-mt-24">
					{isApprovedMember ? (
						<>
							<Button
								onClick={contribute}
								isLoading={contributing}
								disabled={!isLive || !cycleStarted}
								className="w-full md:w-auto"
							>
								Contribute this cycle
							</Button>
							{signing ? (
								<p className="mt-2 text-xs font-light text-primary">
									Confirm the transaction in your wallet…
								</p>
							) : !isLive ? (
								<p className="mt-2 text-xs font-light text-muted-foreground">
									This circle isn&apos;t live on-chain yet — the organizer
									needs to activate it first.
								</p>
							) : !cycleStarted ? (
								<p className="mt-2 text-xs font-light text-muted-foreground">
									Waiting for the organizer to start the cycle. You&apos;ll be
									able to contribute as soon as it&apos;s live.
								</p>
							) : null}
						</>
					) : isPendingMember ? (
						<p className="rounded-xl bg-warning-100 px-4 py-3 text-sm text-warning-800">
							Your request to join is waiting for the organizer&apos;s
							approval. You can contribute once you&apos;re approved.
						</p>
					) : (
						<p className="rounded-xl bg-[#f7f7f7] px-4 py-3 text-sm text-muted-foreground">
							You&apos;re not a member of this circle. Circles are invite-only
							— ask the organizer for an invite link to join.
						</p>
					)}
				</div>
			)}
		</div>
	);
}

/** A single line in the organizer setup checklist. */
function ChecklistItem({
	done,
	label,
	muted,
}: {
	done: boolean;
	label: string;
	muted?: boolean;
}) {
	return (
		<li className="flex items-center gap-2 text-sm">
			<span
				className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ${
					done
						? "bg-success-50 text-success-700"
						: "bg-white text-muted-foreground ring-1 ring-neutral-light-hover"
				}`}
			>
				{done ? "✓" : ""}
			</span>
			<span
				className={
					done
						? "text-neutral-dark"
						: muted
							? "text-muted-foreground"
							: "font-medium"
				}
			>
				{label}
			</span>
		</li>
	);
}
