import React from "react";
import Header from "../../components/dashboard/Header";
import Navbar from "../../components/dashboard/Navbar";
// import CreateGroupFloatBtn from "../../features/group/CreateGroupFloatBtn";

export default function Layout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<div className="lg:flex lg:overflow-clip lg:max-h-screen">
			<div className="lg:flex-4/12 max-w-65 xl:max-w-70">
				<Navbar />
			</div>
			<div className="lg:flex-9/12">
				<Header />
				<div className="pt-24 md:pt-26 lg:pt-5 lg:max-h-screen overflow-y-auto hide-scroll bg-white dashboard-custom-container ">
					<div className="min-h-screen pb-32 lg:pb-60">{children}</div>
					
				</div>
			</div>
		</div>
	);
}
