"use client";
import { DM_Sans } from "next/font/google";
import { useEffect } from "react";
import { HiOutlineExclamationTriangle } from "react-icons/hi2";
import { cn } from "../lib/utils";
import ErrorState from "../components/shared/ErrorState";
import { pageRoutes } from "../config/routes";
import "./globals.css";

const dmSans = DM_Sans({
	variable: "--font-sans",
	subsets: ["latin"],
});

export default function GlobalError({
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
		<html lang="en" className={cn("antialiased", dmSans.variable)}>
			<body className="min-h-full">
				<ErrorState
					icon={<HiOutlineExclamationTriangle />}
					code="ERROR"
					heading="Something Went Wrong"
					description="A critical error occurred and the app couldn't load. Please try again."
					primaryAction={{
						label: "Try Again",
						onClick: unstable_retry,
					}}
					secondaryAction={{
						label: "Visit Homepage",
						href: pageRoutes.landingPage,
					}}
				/>
			</body>
		</html>
	);
}
