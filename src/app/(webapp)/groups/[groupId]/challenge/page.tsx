"use client";

import { useCallback, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import GoBack from "@/components/dashboard/GoBack";
import PageLoading from "@/components/shared/PageLoading";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/hooks/useApi";
import { useWallet } from "@/lib/hooks/useWallet";
import { useChallengeContract } from "@/lib/hooks/useChallengeContract";
import { groups as groupsApi, challenges as challengesApi, auth, ApiError } from "@/lib/api";
import { requireToken } from "@/lib/contract/tokens";
import { addTrustline } from "@/lib/wallet";
import { toStroops, toStroopsOrZero, fromStroops, formatStroops } from "@/lib/stroops";
import { toast } from "@/lib/utils/toast";
import { displayError, errorMessage } from "@/lib/errors";
import { pageRoutes } from "@/config/routes";

/**
 * A savings challenge's detail + deposit view.
 *
 * Unlike a rotating circle, a challenge has no pool, no rotation, and no
 * on-chain group id on the savings contract — deposits go straight to the
 * SEPARATE challenge escrow contract, addressed by this group's own DB id
 * (see `useChallengeContract`). The member's wallet signs the deposit
 * directly; the backend only RECORDS it (backed by the resulting tx hash)
 * and reconciles it against the contract's own `balance_of` shortly after.
 */
export default function ChallengePage() {
	const { groupId } = useParams<{ groupId: string }>();
	const router = useRouter();

	const fetcher = useCallback(() => groupsApi.show(Number(groupId)), [groupId]);
	const { data, loading, error, refetch } = useApi(fetcher, [groupId]);

	const progressFetcher = useCallback(
		() => challengesApi.myProgress(Number(groupId)),
		[groupId],
	);
	const { data: progress, refetch: refetchProgress } = useApi(progressFetcher, [groupId]);

	const summaryFetcher = useCallback(
		() => challengesApi.summary(Number(groupId)),
		[groupId],
	);
	const { data: summary } = useApi(summaryFetcher, [groupId]);

	const meFetcher = useCallback(() => auth.me(), []);
	const { data: me } = useApi(meFetcher, []);

	const { deposit: depositOnchain } = useChallengeContract();
	const { connect, connecting } = useWallet();

	const [amount, setAmount] = useState("");
	const [depositing, setDepositing] = useState(false);
	const [signing, setSigning] = useState(false);

	if (loading || !data) return <PageLoading />;
	if (error) {
		return (
			<div className="mx-auto md:max-w-xl w-full px-0 sm:px-4 py-6">
				<GoBack />
				<p className="mt-6 text-sm text-error-500">{error}</p>
			</div>
		);
	}

	const assetCode = data.asset_code ?? "USDC";
	const target = toStroopsOrZero(data.savings_target ?? "0");
	const saved = toStroopsOrZero(progress?.saved ?? "0");
	const percent = progress?.percent ?? 0;
	const linked = me?.stellar_address ?? null;

	const deposit = async () => {
		const stroops = toStroops(amount);
		if (!stroops || stroops <= 0n) {
			toast.error("Enter an amount greater than zero.", "Invalid amount");
			return;
		}

		let address = linked;
		if (!address) {
			address = await connect();
			if (!address) return;
		}

		setDepositing(true);
		try {
			// The challenge contract locks to whichever token first deposits into
			// it, so this group's configured asset is what every member must use.
			const token = requireToken(assetCode);
			if (!token.native && token.issuer) {
				await addTrustline(address, token.code, token.issuer);
			}

			setSigning(true);
			const txHash = await depositOnchain(Number(groupId), token.sac, stroops);
			setSigning(false);

			// Record it for the activity feed / explorer link. The backend does
			// NOT trust this claimed amount — it reconciles against the
			// challenge contract's own balance_of shortly after (see
			// reconcileChallengeDeposits), so the toast below reflects "sent",
			// not "confirmed".
			await challengesApi.deposit(Number(groupId), {
				amount: fromStroops(stroops),
				stellar_tx_hash: txHash,
			});

			toast.success("Your deposit is on-chain.", "Saved");
			setAmount("");
			refetch();
			refetchProgress();
		} catch (err) {
			const raw = errorMessage(err);

			if (/trustline entry is missing|no trust/i.test(raw)) {
				toast.error(
					`Your wallet can't hold ${assetCode} yet. Add a ${assetCode} trustline in your wallet, then try again.`,
					"Add a trustline first",
				);
			} else if (/insufficient|underfunded/i.test(raw)) {
				toast.error(`Not enough ${assetCode} in your wallet.`, "Insufficient balance");
			} else if (/WrongToken|#3\b/i.test(raw)) {
				toast.error(
					`This challenge is locked to a different asset than ${assetCode}.`,
					"Wrong asset",
				);
			} else if (/User (declined|rejected)|cancell?ed/i.test(raw)) {
				toast.error("You cancelled the signature.", "Cancelled");
			} else {
				toast.error(
					err instanceof ApiError ? err.message : displayError(err, "Something went wrong."),
					"Could not save",
				);
			}
		} finally {
			setDepositing(false);
			setSigning(false);
		}
	};

	return (
		<div className="mx-auto md:max-w-xl lg:max-w-2xl w-full px-0 sm:px-4 py-2">
			<div className="space-y-6">
				<GoBack />

				<div>
					<h2 className="text-xl font-semibold text-neutral-dark">{data.name}</h2>
					{data.description && (
						<p className="mt-1 text-sm font-light text-muted-foreground">
							{data.description}
						</p>
					)}
				</div>

				<div className="bg-neutral-comment rounded-[20px] p-5">
					<div className="flex items-baseline justify-between gap-3">
						<p className="text-sm font-light text-muted-foreground">Your progress</p>
						<p className="text-sm font-medium">{percent}%</p>
					</div>
					<div className="mt-2 h-2 w-full rounded-full bg-white overflow-hidden">
						<div
							className="h-full rounded-full bg-primary transition-all"
							style={{ width: `${Math.min(100, percent)}%` }}
						/>
					</div>
					<p className="mt-2 text-xs font-light text-muted-foreground">
						{formatStroops(saved)} {assetCode}
						{target > 0n ? ` of ${formatStroops(target)} ${assetCode}` : ""}
					</p>
				</div>

				{summary && (
					<div className="text-xs font-light text-muted-foreground">
						{summary.member_count} members ·{" "}
						{formatStroops(toStroopsOrZero(summary.group_saved_total))} {assetCode} saved
						together
						{summary.members_reached_target > 0
							? ` · ${summary.members_reached_target} reached the target`
							: ""}
					</div>
				)}

				<div>
					<p className="text-sm font-light mb-2.5">How much would you like to save?</p>
					<div className="flex items-center gap-3 rounded-full border-2 border-primary px-6 py-4">
						<span className="shrink-0 text-xl font-medium text-muted-foreground md:text-2xl">
							{assetCode}
						</span>
						<input
							type="number"
							value={amount}
							onChange={(e) => setAmount(e.target.value)}
							placeholder="0.00"
							disabled={depositing}
							className="w-full bg-transparent text-xl outline-none md:text-2xl"
						/>
					</div>
				</div>

				<Button
					type="button"
					onClick={deposit}
					disabled={!amount || depositing || connecting}
					isLoading={depositing || connecting}
					className="w-full"
				>
					{signing ? "Confirm in your wallet…" : linked ? "Save" : "Connect wallet to save"}
				</Button>

				{summary?.leaderboard && summary.leaderboard.length > 0 && (
					<div>
						<p className="text-xs font-light text-neutral-light-active border-b border-neutral-light pb-2.5">
							Leaderboard
						</p>
						<div className="mt-3 space-y-3">
							{summary.leaderboard.map((row) => (
								<div key={row.user_id} className="flex items-center justify-between gap-3">
									<span className="text-sm">{row.name ?? "Member"}</span>
									<span className="text-sm font-medium text-muted-foreground">
										{formatStroops(toStroopsOrZero(row.saved))} {assetCode} · {row.percent}%
									</span>
								</div>
							))}
						</div>
					</div>
				)}

				<button
					type="button"
					onClick={() => router.push(pageRoutes.dashboardRoutes.GROUPS)}
					className="text-xs font-light text-muted-foreground underline"
				>
					Back to groups
				</button>
			</div>
		</div>
	);
}
