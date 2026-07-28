export interface CircleGroup {
	id: string;
	title: string;
	subtitle: string;
	image: string;
	current: number;
	target: number;
	status: "PAID" | "PENDING" | "OVERDUE";
	nextPayoutDate: string; // e.g. "Oct 24"
	memberCount: number;
	memberAvatarsImage: string; // stacked avatars image
}

export const circleGroups: CircleGroup[] = [
	{
		id: "circle-1",
		title: "Agro Growth Circle",
		subtitle: "Monthly Contribution",
		image: "/images/about/backed.svg",
		current: 12450,
		target: 50000,
		status: "PAID",
		nextPayoutDate: "Oct 24",
		memberCount: 12,
		memberAvatarsImage: "/images/review-user-imgs.png",
	},
	{
		id: "circle-2",
		title: "Tech Founders Pool",
		subtitle: "Weekly Contribution",
		image: "/images/about/backed.svg",
		current: 38000,
		target: 60000,
		status: "PENDING",
		nextPayoutDate: "Nov 02",
		memberCount: 8,
		memberAvatarsImage: "/images/review-user-imgs.png",
	},
	{
		id: "circle-3",
		title: "Family Emergency Fund",
		subtitle: "Monthly Contribution",
		image: "/images/about/backed.svg",
		current: 5200,
		target: 20000,
		status: "OVERDUE",
		nextPayoutDate: "Oct 18",
		memberCount: 5,
		memberAvatarsImage: "/images/review-user-imgs.png",
	},
	{
		id: "circle-4",
		title: "Real Estate Collective",
		subtitle: "Quarterly Contribution",
		image: "/images/about/backed.svg",
		current: 210000,
		target: 500000,
		status: "PAID",
		nextPayoutDate: "Dec 01",
		memberCount: 20,
		memberAvatarsImage: "/images/review-user-imgs.png",
	},
	{
		id: "circle-5",
		title: "Student Hustlers",
		subtitle: "Weekly Contribution",
		image: "/images/about/backed.svg",
		current: 900,
		target: 5000,
		status: "PENDING",
		nextPayoutDate: "Nov 10",
		memberCount: 15,
		memberAvatarsImage: "/images/review-user-imgs.png",
	},
	{
		id: "circle-6",
		title: "Market Women Union",
		subtitle: "Daily Contribution",
		image: "/images/about/backed.svg",
		current: 74000,
		target: 100000,
		status: "PAID",
		nextPayoutDate: "Oct 30",
		memberCount: 30,
		memberAvatarsImage: "/images/review-user-imgs.png",
	},
	{
		id: "circle-7",
		title: "Diaspora Builders",
		subtitle: "Monthly Contribution",
		image: "/images/about/backed.svg",
		current: 15750,
		target: 40000,
		status: "PENDING",
		nextPayoutDate: "Nov 15",
		memberCount: 10,
		memberAvatarsImage: "/images/review-user-imgs.png",
	},
	{
		id: "circle-8",
		title: "Wedding Support Circle",
		subtitle: "Monthly Contribution",
		image: "/images/about/backed.svg",
		current: 3200,
		target: 8000,
		status: "PAID",
		nextPayoutDate: "Oct 27",
		memberCount: 6,
		memberAvatarsImage: "/images/review-user-imgs.png",
	},
];
