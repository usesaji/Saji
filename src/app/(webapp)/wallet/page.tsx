import WalletHeroCard from "../../../features/wallet/WalletHeroCard";
import RecentActivities from "../../../features/overview/RecentActivities";
import UsefulInsights from "../../../features/wallet/UsefulInsights";
import UpcomingContribution from "../../../features/wallet/UpcomingContribution";

export default function Page() {
	return (
		<div>
			<WalletHeroCard />

			<RecentActivities />

			<UsefulInsights />

			<UpcomingContribution />
		</div>
	);
}
