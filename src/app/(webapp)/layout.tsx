import React from "react";
import Header from "../../components/dashboard/Header";
import Navbar from "../../components/dashboard/Navbar";

export default function Layout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<div className="">
			<Navbar />
			<div className="">
				<Header />
				<div className="pt-20 h-[200vh] bg-green-400">{children}</div>
			</div>
		</div>
	);
}
