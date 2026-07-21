import React from "react";
import Header from "../../components/landing/Header";

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<div>
			<div className="max-:hidden">
				<Header />
			</div>
			<div className="lg:px-10 xl:px-20">{children}</div>
		</div>
	);
}
