export type GroupVisibility = "public" | "private";

/** "owner" = you created it, "member" = you've joined it, "none" = you haven't joined yet. */
export type GroupMembership = "owner" | "member" | "none";

export type PayoutOrderType = "random" | "manual" | "vote" | "custom";

export interface PayoutRotationMember {
	id: string;
	name: string;
	role: string; // "Organizer" | "Member"
	date: string; // payout date, e.g. "Oct 15"
	isSelf?: boolean; // renders the logged-in user's real avatar instead of initials
}

export interface CircleGroup {
	id: string;
	title: string;
	subtitle: string;
	image: string; // small thumbnail used in list cards
	bannerImage: string; // large hero image used on the preview page
	current: number;
	target: number;
	status: "PAID" | "PENDING" | "OVERDUE";
	nextPayoutDate: string; // e.g. "Oct 24"
	memberCount: number;
	memberAvatarsImage: string; // stacked avatars image
	groupType: string; // e.g. "Rotating" | "Fixed"
	payoutOrder: string; // e.g. "Randomized" | "Sequential"
	frequency: string; // e.g. "Monthly" | "Weekly" | "Daily"
	latePenaltyLabel: string; // e.g. "5% after 3 days"
	joinMessage: string;

	visibility: GroupVisibility;
	membership: GroupMembership;
	payoutOrderType: PayoutOrderType;
	contributionAmount: number;
	contributionDueInDays: number;
	payoutRotation: PayoutRotationMember[];
}

const defaultRotation: PayoutRotationMember[] = [
	{ id: "m1", name: "Dean Ogude", role: "Organizer", date: "Oct 15", isSelf: true },
	{ id: "m2", name: "Ademola A.", role: "Member", date: "Nov 15" },
	{ id: "m3", name: "Henry O.", role: "Member", date: "Dec 15" },
	{ id: "m4", name: "Funmilayo A.", role: "Member", date: "Jan 15" },
	{ id: "m5", name: "Chiamaka J.", role: "Member", date: "Feb 15" },
];

export const circleGroups: CircleGroup[] = [
	{
		id: "circle-1",
		title: "Agro Growth Circle",
		subtitle: "Monthly Contribution",
		image: "/images/about/backed.svg",
		bannerImage: "/images/group-test-img.png",
		current: 12450,
		target: 50000,
		status: "PAID",
		nextPayoutDate: "Oct 24",
		memberCount: 12,
		memberAvatarsImage: "/images/review-user-imgs.png",
		groupType: "Rotating",
		payoutOrder: "Randomized",
		frequency: "Monthly",
		latePenaltyLabel: "5% after 3 days",
		joinMessage:
			"Invitation links will be sent once the group is created & finalized, added members will also be notified to confirm their addition.",
		visibility: "public",
		membership: "owner",
		payoutOrderType: "custom",
		contributionAmount: 250,
		contributionDueInDays: 3,
		payoutRotation: defaultRotation,
	},
	{
		id: "circle-2",
		title: "Tech Founders Pool",
		subtitle: "Weekly Contribution",
		image: "/images/about/backed.svg",
		bannerImage: "/images/group-test-img.png",
		current: 38000,
		target: 60000,
		status: "PENDING",
		nextPayoutDate: "Nov 02",
		memberCount: 8,
		memberAvatarsImage: "/images/review-user-imgs.png",
		groupType: "Fixed",
		payoutOrder: "Sequential",
		frequency: "Weekly",
		latePenaltyLabel: "3% after 2 days",
		joinMessage:
			"Invitation links will be sent once the group is created & finalized, added members will also be notified to confirm their addition.",
		visibility: "private",
		membership: "member",
		payoutOrderType: "manual",
		contributionAmount: 500,
		contributionDueInDays: 5,
		payoutRotation: defaultRotation,
	},
	{
		id: "circle-3",
		title: "Family Emergency Fund",
		subtitle: "Monthly Contribution",
		image: "/images/about/backed.svg",
		bannerImage: "/images/group-test-img.png",
		current: 5200,
		target: 20000,
		status: "OVERDUE",
		nextPayoutDate: "Oct 18",
		memberCount: 5,
		memberAvatarsImage: "/images/review-user-imgs.png",
		groupType: "Rotating",
		payoutOrder: "Sequential",
		frequency: "Monthly",
		latePenaltyLabel: "10% after 1 day",
		joinMessage:
			"Invitation links will be sent once the group is created & finalized, added members will also be notified to confirm their addition.",
		visibility: "private",
		membership: "owner",
		payoutOrderType: "custom",
		contributionAmount: 150,
		contributionDueInDays: 1,
		payoutRotation: defaultRotation.slice(0, 3),
	},
	{
		id: "circle-4",
		title: "Real Estate Collective",
		subtitle: "Quarterly Contribution",
		image: "/images/about/backed.svg",
		bannerImage: "/images/group-test-img.png",
		current: 210000,
		target: 500000,
		status: "PAID",
		nextPayoutDate: "Dec 01",
		memberCount: 20,
		memberAvatarsImage: "/images/review-user-imgs.png",
		groupType: "Fixed",
		payoutOrder: "Randomized",
		frequency: "Quarterly",
		latePenaltyLabel: "5% after 5 days",
		joinMessage:
			"Invitation links will be sent once the group is created & finalized, added members will also be notified to confirm their addition.",
		visibility: "public",
		membership: "member",
		payoutOrderType: "random",
		contributionAmount: 2500,
		contributionDueInDays: 12,
		payoutRotation: defaultRotation,
	},
	{
		id: "circle-5",
		title: "Student Hustlers",
		subtitle: "Weekly Contribution",
		image: "/images/about/backed.svg",
		bannerImage: "/images/group-test-img.png",
		current: 900,
		target: 5000,
		status: "PENDING",
		nextPayoutDate: "Nov 10",
		memberCount: 15,
		memberAvatarsImage: "/images/review-user-imgs.png",
		groupType: "Rotating",
		payoutOrder: "Randomized",
		frequency: "Weekly",
		latePenaltyLabel: "2% after 3 days",
		joinMessage:
			"Invitation links will be sent once the group is created & finalized, added members will also be notified to confirm their addition.",
		visibility: "public",
		membership: "member",
		payoutOrderType: "vote",
		contributionAmount: 50,
		contributionDueInDays: 2,
		payoutRotation: defaultRotation,
	},
	{
		id: "circle-6",
		title: "Market Women Union",
		subtitle: "Daily Contribution",
		image: "/images/about/backed.svg",
		bannerImage: "/images/group-test-img.png",
		current: 74000,
		target: 100000,
		status: "PAID",
		nextPayoutDate: "Oct 30",
		memberCount: 30,
		memberAvatarsImage: "/images/review-user-imgs.png",
		groupType: "Rotating",
		payoutOrder: "Sequential",
		frequency: "Daily",
		latePenaltyLabel: "1% after 1 day",
		joinMessage:
			"Invitation links will be sent once the group is created & finalized, added members will also be notified to confirm their addition.",
		visibility: "public",
		membership: "owner",
		payoutOrderType: "manual",
		contributionAmount: 20,
		contributionDueInDays: 1,
		payoutRotation: defaultRotation,
	},
	{
		id: "circle-7",
		title: "Diaspora Builders",
		subtitle: "Monthly Contribution",
		image: "/images/about/backed.svg",
		bannerImage: "/images/group-test-img.png",
		current: 15750,
		target: 40000,
		status: "PENDING",
		nextPayoutDate: "Nov 15",
		memberCount: 10,
		memberAvatarsImage: "/images/review-user-imgs.png",
		groupType: "Fixed",
		payoutOrder: "Randomized",
		frequency: "Monthly",
		latePenaltyLabel: "5% after 3 days",
		joinMessage:
			"Invitation links will be sent once the group is created & finalized, added members will also be notified to confirm their addition.",
		visibility: "public",
		membership: "none",
		payoutOrderType: "random",
		contributionAmount: 300,
		contributionDueInDays: 7,
		payoutRotation: defaultRotation,
	},
	{
		id: "circle-8",
		title: "Wedding Support Circle",
		subtitle: "Monthly Contribution",
		image: "/images/about/backed.svg",
		bannerImage: "/images/group-test-img.png",
		current: 3200,
		target: 8000,
		status: "PAID",
		nextPayoutDate: "Oct 27",
		memberCount: 6,
		memberAvatarsImage: "/images/review-user-imgs.png",
		groupType: "Rotating",
		payoutOrder: "Sequential",
		frequency: "Monthly",
		latePenaltyLabel: "5% after 3 days",
		joinMessage:
			"Invitation links will be sent once the group is created & finalized, added members will also be notified to confirm their addition.",
		visibility: "private",
		membership: "none",
		payoutOrderType: "manual",
		contributionAmount: 100,
		contributionDueInDays: 4,
		payoutRotation: defaultRotation.slice(0, 4),
	},
];

/** Look up a single circle group by its id — returns undefined if not found. */
export function getCircleById(id: string): CircleGroup | undefined {
	return circleGroups.find((circle) => circle.id === id);
}
