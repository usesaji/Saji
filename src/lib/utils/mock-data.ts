/**
 * View model for the group cards / preview UI.
 *
 * NOTE: this file no longer holds any mock records — those were removed once the
 * group screens were wired to the backend. The backend `Group` is mapped into
 * this shape by `features/group/group-view.ts` so the existing card/preview
 * markup can render real data unchanged. The name/path are kept only so those
 * components' imports stay stable.
 */
export interface CircleGroup {
	id: string;
	title: string;
	subtitle: string;
	image: string; // small thumbnail used in list cards
	bannerImage: string; // large hero image used on the preview page
	current: number;
	target: number;
	status: "PAID" | "PENDING" | "OVERDUE";
	/**
	 * When the next contribution is due ("Oct 24"), or "—".
	 *
	 * The cycle BOUNDARY, not a payout date — a cycle settles as soon as
	 * everyone has funded it, which is often earlier.
	 */
	nextDepositDate: string;
	memberCount: number;
	/**
	 * Real members for the avatar stack, newest mapping first. Empty when the
	 * payload doesn't carry them (e.g. the join preview), in which case the card
	 * falls back to initials rather than to stock faces.
	 */
	memberAvatars?: { name: string; avatar_url: string | null }[];
	groupType: string; // e.g. "Rotating" | "Fixed"
	payoutOrder: string; // e.g. "Randomized" | "Sequential"
	frequency: string; // e.g. "Monthly" | "Weekly" | "Daily"
	latePenaltyLabel: string; // e.g. "5% after 3 days"
	joinMessage: string;
}
