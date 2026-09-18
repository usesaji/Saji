"use client";

/* eslint-disable @next/next/no-img-element */
import { useCallback, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { FaCalendarCheck } from "react-icons/fa";
import { HiMiniUsers } from "react-icons/hi2";
import { RiMoneyDollarCircleFill } from "react-icons/ri";
import { PiWarningCircleFill } from "react-icons/pi";
import GoBack from "@/components/dashboard/GoBack";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/hooks/useApi";
import { groups as groupsApi, assetUrl, ApiError } from "@/lib/api";
import { labelize } from "@/features/group/group-view";
import { pageRoutes } from "@/config/routes";
import { toast } from "@/lib/utils/toast";

const BANNER_PLACEHOLDER = "/images/group-test-img.png";

const formatCurrency = (value: string | null) => {
	const n = Number(value ?? 0);
	return `$${n.toLocaleString(undefined, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`;
};

/** Join Group page — what a prospective member sees behind an invite link. */
export default function JoinGroupPage() {
	const { token } = useParams<{ token: string }>();
	const router = useRouter();
	const [joining, setJoining] = useState(false);

	const fetcher = useCallback(
		() => groupsApi.joinPreviewTyped(token),
		[token],
	);
	const { data, loading, error, refetch } = useApi(fetcher, [token]);

	const onJoin = async () => {
		setJoining(true);
		try {
			const member = await groupsApi.joinByToken(token);
			toast.success(
				member.status === "approved"
					? "You're in — welcome to the circle."
					: "Request sent — the organizer will approve you.",
				"Joined",
			);
			router.push(
				data
					? pageRoutes.dashboardRoutes.GROUP(String(data.id))
					: pageRoutes.dashboardRoutes.GROUPS,
			);
		} catch (err) {
			toast.error(
				err instanceof ApiError ? err.message : "Something went wrong.",
				"Could not join",
			);
		} finally {
			setJoining(false);
		}
	};

	const settingRows = data
		? [
				{
					Icon: HiMiniUsers,
					color: "text-primary",
					label: "Group Type",
					value: labelize(data.settings.group_type),
				},
				{
					Icon: RiMoneyDollarCircleFill,
					color: "text-primary",
					label: "Payout Order",
					value: labelize(data.settings.payout_order),
				},
				{
					Icon: FaCalendarCheck,
					color: "text-primary",
					label: "Frequency",
					value: labelize(data.settings.contribution_frequency),
				},
				{
					Icon: PiWarningCircleFill,
					color: "text-[#FF0000]",
					label: "Late Penalty",
					value: labelize(data.settings.late_penalty),
				},
			]
		: [];

	return (
		<div>
			<GoBack />

			{loading && (
				<p className="mt-6 text-center text-sm text-muted-foreground">
					Loading invite…
				</p>
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
				<div className="mt-4 md:mt-6">
					<h2 className="text-xl md:text-3xl">{data.name}</h2>
					{data.description && (
						<p className="mt-1 text-sm font-light text-muted-foreground">
							{data.description}
						</p>
					)}

					<div className="rounded-2xl overflow-hidden h-36 mt-3 md:h-48 lg:h-52">
						<img
							alt={`${data.name} banner`}
							src={assetUrl(data.photo_url, BANNER_PLACEHOLDER)}
							className="h-full w-full object-cover"
						/>
					</div>

					<section className="mt-3 flex flex-col gap-2 md:flex-row md:mt-5 md:gap-4">
						<div className="bg-[#f7f7f7] rounded-2xl p-4 md:flex-1 md:p-6 min-w-0">
							<h5 className="text-xs font-light md:text-sm">Target Goal</h5>
							<h3 className="font-medium text-2xl md:text-3xl lg:text-4xl truncate max-w-full mt-1 md:mt-2">
								{formatCurrency(data.target_amount)}
							</h3>
						</div>

						<div className="bg-[#f7f7f7] rounded-2xl p-4 md:flex-1 md:p-6">
							<h5 className="text-xs font-light md:text-sm">
								{data.member_count} Members
							</h5>
							<div className="mt-2 text-sm font-light text-muted-foreground">
								Contribution: {formatCurrency(data.settings.contribution_amount)}
							</div>
						</div>
					</section>

					<section className="mt-5 md:mt-7">
						<h3 className="md:text-xl">Group Settings</h3>

						<div className="mt-3 space-y-3 md:mt-5 md:space-y-4">
							{settingRows.map(({ Icon, color, label, value }, i) => (
								<div
									key={label}
									className={`flex justify-between items-center pb-2 ${
										i < settingRows.length - 1
											? "border-b border-b-[#d9d9d9]"
											: ""
									}`}
								>
									<div className="flex items-center gap-1 md:gap-2">
										<Icon className={`${color} text-xl`} />
										<p className="text-sm font-light md:text-base md:font-normal">
											{label}
										</p>
									</div>
									<div className="text-sm md:text-base font-medium">{value}</div>
								</div>
							))}
						</div>
					</section>

					<section className="mt-5">
						<div className="bg-[#f7f7f7] rounded-2xl p-4 md:p-6">
							<h5 className="text-base lg:text-xl md:font-medium">
								Join the Others
							</h5>
							<p className="text-xs font-light md:text-sm mt-2 lg:text-base md:w-2/3">
								{data.settings.auto_approve_join
									? "This circle admits members instantly."
									: "The organizer will confirm your request to join."}
							</p>
						</div>

						<Button
							variant="secondary"
							className="mt-5 md:mt-7"
							onClick={onJoin}
							isLoading={joining}
						>
							Join Group
						</Button>
					</section>
				</div>
			)}
		</div>
	);
}
