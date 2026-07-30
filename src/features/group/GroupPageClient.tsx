"use client";
import React from "react";
import { CircleGroup } from "../../lib/utils/mock-data";
import { getEffectiveMembership, useGroupMembershipStore } from "../../lib/store/group-membership-store";
import GroupPreview from "./GroupPreview";
import GroupDetailView from "./GroupDetailView";

interface GroupPageClientProps {
	group: CircleGroup;
}

export default function GroupPageClient({ group }: GroupPageClientProps) {
	const joinedGroupIds = useGroupMembershipStore((state) => state.joinedGroupIds);
	const membership = getEffectiveMembership(group, joinedGroupIds);

	if (membership === "none") {
		return <GroupPreview group={group} />;
	}

	return <GroupDetailView group={group} isOwner={membership === "owner"} />;
}
