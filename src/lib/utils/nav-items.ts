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
		label: "Home",
		href: pageRoutes.dashboardRoutes.HOME,
		Icon: HomeIcon,
	},
	{
		label: "Groups",
		href: pageRoutes.dashboardRoutes.GROUP,
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
		label: "Me",
		href: pageRoutes.dashboardRoutes.ME,
		Icon: MeIcon,
	},
];
