import { create } from "zustand";
import { CircleGroup, GroupMembership } from "../utils/mock-data";

interface GroupMembershipState {
	/** Group ids joined this session, overriding the mock data's base membership. */
	joinedGroupIds: string[];
	joinGroup: (id: string) => void;
}

export const useGroupMembershipStore = create<GroupMembershipState>((set) => ({
	joinedGroupIds: [],
	joinGroup: (id) =>
		set((state) =>
			state.joinedGroupIds.includes(id)
				? state
				: { joinedGroupIds: [...state.joinedGroupIds, id] },
		),
}));

/** Merges a group's base membership with any session-only join override. */
export function getEffectiveMembership(
	group: CircleGroup,
	joinedGroupIds: string[],
): GroupMembership {
	if (group.membership !== "none" && joinedGroupIds.includes(group.id)) {
		return group.membership;
	}
	return joinedGroupIds.includes(group.id) ? "member" : group.membership;
}
