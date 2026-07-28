import {
	HomeIcon,
	GroupsIcon,
	ActivityIcon,
	WalletIcon,
	MeIcon,
} from "./nav-icons";
import { pageRoutes } from "../../config/routes";

export const navItems = [
	{
		label: "Overview",
		href: pageRoutes.dashboardRoutes.OVERVIEW,
		Icon: HomeIcon,
	},
	{
		label: "Groups",
		href: pageRoutes.dashboardRoutes.GROUPS,
		Icon: GroupsIcon,
	},
	{
		label: "Activity",
		href: pageRoutes.dashboardRoutes.ACTIVITY,
		Icon: ActivityIcon,
	},
	{
		label: "Wallet",
		href: pageRoutes.dashboardRoutes.WALLET,
		Icon: WalletIcon,
	},
	{
		label: "My Account",
		href: pageRoutes.dashboardRoutes.ME,
		Icon: MeIcon,
	},
];
