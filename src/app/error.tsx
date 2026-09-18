"use client";
import { useEffect } from "react";
import { HiOutlineExclamationTriangle } from "react-icons/hi2";
import ErrorState from "../components/shared/ErrorState";
import { pageRoutes } from "../config/routes";

export default function Error({
	error,
	unstable_retry,
}: {
	error: Error & { digest?: string };
	unstable_retry: () => void;
}) {
	useEffect(() => {
		console.error(error);
	}, [error]);

	return (
		<ErrorState
			icon={<HiOutlineExclamationTriangle />}
			code="ERROR"
			heading="Something Went Wrong"
			description="We hit an unexpected error while loading this page. Try again, or head back to the dashboard."
			primaryAction={{
				label: "Try Again",
				onClick: unstable_retry,
			}}
			secondaryAction={{
				label: "Back to Dashboard",
				href: pageRoutes.dashboardRoutes.OVERVIEW,
			}}
		/>
	);
}
