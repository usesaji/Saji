import { DM_Sans } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { Metadata } from "next";

const dmSans = DM_Sans({
	variable: "--font-sans",
	subsets: ["latin"],
});

export const metadata: Metadata = {
	title: {
		default: "Saji",
		template: "%s | Saji",
	},
	description:
		"SAJI is a savings platform built for how West Africa actually saves — community-first, transparent, and fraud-proof. Save individually or in groups, track contributions with confidence, and manage collective savings without the stress, confusion, or trust issues common with informal systems.",
	keywords: [
		"Saji",
		"savings platform",
		"group savings",
		"ajo",
		"esusu",
		"thrift savings",
		"community savings",
		"West Africa fintech",
		"digital savings",
		"cooperative savings",
		"rotational savings",
		"contribution platform",
		"fraud-proof savings",
		"transparent savings",
		"money management",
	],
	authors: [{ name: "Saji" }],
	creator: "Saji",
	metadataBase: new URL("https://usesaji.com"), // replace with actual domain
	openGraph: {
		type: "website",
		locale: "en_US",
		url: "https://usesaji.com",
		siteName: "Saji",
		title: "Saji — Save Better Together",
		description:
			"A community-first savings platform for West Africa. Save transparently, contribute confidently, and manage group savings without trust issues.",
		images: [
			{
				url: "/images/link-preview.png", // add a 1200x630 image to your /public folder
				width: 1200,
				height: 630,
				alt: "Saji",
			},
		],
	},
	twitter: {
		card: "summary_large_image",
		title: "Saji — Save Better Together",
		description:
			"A community-first savings platform for West Africa. Save transparently, contribute confidently, and manage group savings without trust issues.",
		images: ["/images/link-preview.png"],
		creator: "@saji", // replace with actual handle
	},
	robots: {
		index: true,
		follow: true,
		googleBot: {
			index: true,
			follow: true,
			"max-image-preview": "large",
		},
	},
	icons: {
		icon: "/favicon.ico",
		shortcut: "/favicon-16x16.png",
		apple: "/apple-touch-icon.png",
	},
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en" className={cn("antialiased", dmSans.variable)}>
			<body className="min-h-full">{children}</body>
		</html>
	);
}
