"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

const details = [
	{
		img: "/images/auth/esusu.svg",
		title: "Esusu evolved.",
		text: "The traditional way, with a digital guarantee.",
	},
	{
		img: "/images/auth/group-savings.svg",
		title: "Save with your people.",
		text: "Your group. Your rules. Everyone accountable.",
	},
	{
		img: "/images/auth/hands-n-money.svg",
		title: "Your Ajo, now on-chain.",
		text: "Save together. Get paid automatically.",
	},
];

const PicSlide = () => {
	const [current, setCurrent] = useState(0);

	useEffect(() => {
		const interval = setInterval(() => {
			setCurrent((prev) => (prev + 1) % details.length);
		}, 3000);

		return () => clearInterval(interval);
	}, []);

	return (
		// <div className="relative h-full min-h-125 overflow-hidden">
		// <div className="relative h-105 overflow-hidden">
		<div className="relative h-70 sm:h-105 lg:h-130 overflow-hidden">
			{details.map((slide, index) => (
				<div
					key={index}
					className={`absolute inset-0 flex flex-col transition-opacity duration-1000 ${
						current === index ? "opacity-100" : "opacity-0 pointer-events-none"
					}`}
				>
					<div className="mb-8 font-light text-black md:text-center lg:order-2 lg:mt-5">
						<h2 className="text-[28px] lg:text-[36px]">{slide.title}</h2>
						<p className="text-sm lg:text-base">{slide.text}</p>
					</div>

					<div className="relative flex-1">
						<Image
							src={slide.img}
							alt={slide.title}
							loading="eager"
							fill
							className="object-contain"
						/>
					</div>
				</div>
				// <div
				// 	key={index}
				// 	className={`absolute inset-0 flex flex-col gap-20 transition-all duration-1000 ease-in-out ${
				// 		current === index
				// 			? "opacity-100 translate-y-0 z-10"
				// 			: "opacity-0 translate-y-4 z-0 pointer-events-none"
				// 	}`}
				// >
				// 	<div className="font-light text-black">
				// 		<h2 className="text-[28px]">{slide.title}</h2>
				// 		<p className="text-sm">{slide.text}</p>
				// 	</div>

				// 	<div className="w-full">
				// 		<Image
				// 			src={slide.img}
				// 			alt={slide.title}
				// 			width={1000}
				// 			height={1000}
				// 			className="object-contain hfull w-full"
				// 		/>
				// 	</div>
				// </div>
			))}
		</div>
	);
};

export default PicSlide;
