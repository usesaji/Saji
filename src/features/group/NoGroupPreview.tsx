"use client";
import Image from "next/image";
import React from "react";
import { Button } from "../../components/ui/button";
import { pageRoutes } from "../../config/routes";

const NoGroupPreview = () => {
	return (
		<div>
			<h2 className="text-2xl text-center mt-2">Build Your Circle</h2>
			<p className="w-3/4 text-center mx-auto">
				Create a savings group and reach your community targets together
			</p>

			<div className="w-70 mt-10 mx-auto">
				<Image
					alt="Image of people"
					src="/images/auth/group-savings.svg"
					height={400}
					width={400}
					className="h-full w-full"
				/>
			</div>

			<div className="w-full">
				<Button
					href={pageRoutes.dashboardRoutes.NEW_GROUP}
					className="w-full mt-16"
				>
					Let&apos; Start
				</Button>
			</div>
		</div>
	);
};

export default NoGroupPreview;
