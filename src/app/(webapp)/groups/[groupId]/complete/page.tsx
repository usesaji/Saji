"use client";

/* eslint-disable @next/next/no-img-element */
import { useCallback } from "react";
import { useParams } from "next/navigation";
import { LuTarget } from "react-icons/lu";
import GoBack from "@/components/dashboard/GoBack";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/hooks/useApi";
import { groups as groupsApi } from "@/lib/api";
import { pageRoutes } from "@/config/routes";

const AVATARS = "/images/review-user-imgs.png";

/**
 * Group Completion — the celebratory "Cycle Completed!" screen shown after a
 * payout rotation completes. Surfaces the total saved and reward points, with a
 * nudge to keep going.
 */
export default function GroupCompletePage() {
	const { groupId } = useParams<{ groupId: string }>();
	const fetcher = useCallback(
		() => groupsApi.circle(Number(groupId)),
		[groupId],
	);
	const { data } = useApi(fetcher, [groupId]);

	const totalSaved = data
		? `${Number(data.total_deposited).toLocaleString()} ${data.group.asset_code}`
		: "—";
	// Simple points model: 1 point per unit contributed this rotation.
	const points = data ? Math.round(Number(data.user_progress.paid)) : 0;

	return (
		<div className="mx-auto max-w-lg pb-10">
			<GoBack />

			<div className="py-10 text-center">
				<div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-[#efeaff] text-primary">
					<LuTarget className="text-5xl" />
				</div>
				<h2 className="mt-6 text-2xl font-medium">Cycle Completed!</h2>
				<p className="mt-2 text-sm text-muted-foreground">
					Together you&apos;ve reached the finish line. Every contribution paid
					off — nice work.
				</p>

				{/* Reward tiles */}
				<div className="mt-8 grid grid-cols-2 gap-3 text-left">
					<div className="rounded-2xl bg-primary p-4 text-white">
						<p className="text-xs font-light">Total Savings</p>
						<p className="mt-1 text-2xl font-medium">{totalSaved}</p>
					</div>
					<div className="rounded-2xl bg-[#efeaff] p-4 text-primary">
						<p className="text-xs font-light">Your Points Earned</p>
						<p className="mt-1 text-2xl font-medium">+{points} pts</p>
					</div>
				</div>

				{/* Join the others */}
				<div className="mt-4 rounded-2xl bg-[#f7f7f7] p-4 text-left">
					<p className="text-sm font-medium">Keep the momentum</p>
					<p className="text-xs font-light text-muted-foreground">
						Join or start another circle and keep growing together.
					</p>
					<div className="mt-3 h-8">
						<img src={AVATARS} alt="" className="h-full" />
					</div>
				</div>

				{/* This is the moment the user is thinking about their money, so
				    point at it rather than dead-ending on "Go to Home". */}
				<p className="mt-8 text-sm text-muted-foreground">
					Your payout is in your Saji Balance. Withdraw it to any wallet you
					choose.
				</p>
				<Button
					href={pageRoutes.dashboardRoutes.WITHDRAW}
					className="mt-3 w-full"
				>
					Withdraw your payout
				</Button>
				<Button
					href={pageRoutes.dashboardRoutes.OVERVIEW}
					variant="outline"
					className="mt-3 w-full"
				>
					Go to Home
				</Button>
			</div>
		</div>
	);
}
