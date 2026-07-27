import React from "react";
import Header from "../../components/dashboard/Header";
import Navbar from "../../components/dashboard/Navbar";

export default function Layout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<div className="lg:flex lg:overflow-hidden lg:max-h-screen">
			<div className="lg:flex-4/12 max-w-65 xl:max-w-70">
				<Navbar />
			</div>
			<div className="lg:flex-9/12">
				<Header />
				<div className="pt-20 md:pt-24 lg:pt-0 lg:max-h-screen overflow-y-auto hide-scroll bg-white dashboard-custom-container">
					<div className="h-[200vh]">{children}</div>
				</div>
			</div>
		</div>
	);
}
