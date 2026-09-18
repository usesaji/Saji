import { HiOutlineFaceFrown } from "react-icons/hi2";
import ErrorState from "../components/shared/ErrorState";
import { pageRoutes } from "../config/routes";

export default function NotFound() {
	return (
		<ErrorState
			icon={<HiOutlineFaceFrown />}
			code="404"
			heading="Page Not Found"
			description="The page you're looking for doesn't exist or may have been moved. Let's get you back on track."
			primaryAction={{
				label: "Back to Dashboard",
				href: pageRoutes.dashboardRoutes.OVERVIEW,
			}}
			secondaryAction={{
				label: "Visit Homepage",
				href: pageRoutes.landingPage,
			}}
		/>
	);
}
