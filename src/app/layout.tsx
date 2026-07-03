import type { Metadata } from "next";
import { DM_Sans, Geist } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const dmSans = DM_Sans({
	variable: "--font-dm-sans",
	subsets: ["latin"],
});

export const metadata: Metadata = {
	title: "Saji",
	description:
		"SAJI is the savings platform built for how West Africa actually saves  community-first, transparent, and fraud-proof.",
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en" className={cn("antialiased", dmSans.variable, "font-sans", geist.variable)}>
			<body className="min-h-full">{children}</body>
		</html>
	);
}
