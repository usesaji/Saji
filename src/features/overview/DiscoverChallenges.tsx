"use client";

/* eslint-disable @next/next/no-img-element */
import { useCallback, useState } from "react";
import Link from "next/link";
import { IoIosArrowRoundForward } from "react-icons/io";
import { HiOutlineUserPlus } from "react-icons/hi2";
import { Button } from "../../components/ui/button";
import { useApi } from "../../lib/hooks/useApi";
import {
	challenges as challengesApi,
	assetUrl,
	ApiError,
	type Group,
} from "../../lib/api";
import { pageRoutes } from "../../config/routes";
import { toast } from "../../lib/utils/toast";

const PLACEHOLDER = "/images/group-test-img.png";

/**
 * "Public Saving Groups" — open public groups anyone can discover and join.
 * (Internally these are the backend's "challenge" circles: a shared savings
 * target, open membership.) Backed by GET /api/challenges; join is instant.
 */
export default function DiscoverChallenges({
	title = "Public Saving Groups",
}: {
	title?: string;
}) {
	const fetcher = useCallback(() => challengesApi.index({ per_page: 8 }), []);
	const { data, loading, refetch } = useApi(fetcher, []);
	const items = data?.data ?? [];

	return (
		<section className="mt-8">
			<div className="flex items-center justify-between">
				<h4 className="md:text-lg">{title}</h4>
				<Link
					href={pageRoutes.dashboardRoutes.GROUPS}
					className="flex items-center text-xs md:text-sm"
				>
					View All <IoIosArrowRoundForward className="text-lg md:text-2xl" />
				</Link>
			</div>

			{loading ? (
				<p className="mt-4 text-sm text-muted-foreground">
					Loading public groups…
				</p>
			) : items.length === 0 ? (
				<p className="mt-4 text-sm text-muted-foreground">
					No public saving groups yet — check back soon.
				</p>
			) : (
				<div className="mt-4 flex gap-4 overflow-x-auto hide-scroll pb-2">
					{items.map((c) => (
						<ChallengeCard key={c.id} challenge={c} onJoined={refetch} />
					))}
				</div>
			)}
		</section>
	);
}

function ChallengeCard({
	challenge,
	onJoined,
}: {
	challenge: Group;
	onJoined: () => void;
}) {
	const [joining, setJoining] = useState(false);

	const join = async () => {
		setJoining(true);
		try {
			await challengesApi.join(challenge.id);
			toast.success(`You joined “${challenge.name}”.`, "Joined group");
			onJoined();
		} catch (err) {
			toast.error(
				err instanceof ApiError ? err.message : "Could not join.",
				"Failed",
			);
		} finally {
			setJoining(false);
		}
	};

	const members = challenge.member_count ?? challenge.members_count ?? 0;

	return (
		<div className="w-60 shrink-0 overflow-hidden rounded-2xl bg-[#f8f8f8]">
			<div className="h-28 w-full overflow-hidden">
				<img
					src={assetUrl(challenge.photo_url, PLACEHOLDER)}
					alt={challenge.name}
					className="h-full w-full object-cover"
				/>
			</div>
			<div className="p-3">
				<p className="truncate text-sm font-medium">{challenge.name}</p>
				<p className="text-xs text-muted-foreground">
					{members} {members === 1 ? "member" : "members"}
					{challenge.savings_target
						? ` · target ${Number(challenge.savings_target).toLocaleString()} ${challenge.asset_code}`
						: ""}
				</p>
				<Button
					size="sm"
					variant="dark"
					className="mt-3 w-full"
					isLoading={joining}
					onClick={join}
				>
					<HiOutlineUserPlus />
					<span>Join Now</span>
				</Button>
			</div>
		</div>
	);
}
