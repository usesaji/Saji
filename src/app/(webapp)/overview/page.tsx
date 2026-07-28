import { WalletCard } from "../../../features/wallet/WalletBallanceCard";
import MyCircles from "../../../features/overview/MyCircles";
import RecentActivities from "../../../features/overview/RecentActivities";

export default function Page() {
	return (
		<div>
			<WalletCard />

			<MyCircles />

			<RecentActivities />
		</div>
	);
}
