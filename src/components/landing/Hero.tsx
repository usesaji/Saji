import Image from "next/image";
import React from "react";
import { Button } from "../ui/button";

export default function Hero() {
	return (
		<section className="custom-container">
			<div className="max-h-screen overflow-hidden flex flex-col md:flex-row md:gap-16 px-6 lg:px-10 bg-primary text-primary-light rounded-[27px] lg:rounded-[40px] pt-10 lg:pt-20 relative ">
				<div className="space-y-2.5 flex flex-col items-start z-10 sm:w-3/4 sm:space-y-4 pb-10 lg:pb-30 lg:space-y-2">
					<div className="h-11 flex items-center gap-5">
						<Image
							alt="Hero Image"
							src="/images/hero-user-imgs.svg"
							height={1200}
							width={1200}
							className="h-full w-full object-contain"
						/>
						<span className="whitespace-nowrap text-base md:text-xlx">
							2.4K+ Users
						</span>
					</div>
					<h1 className="text-[47px] sm:text-6xl md:text-4xl lg:text-[60px] xl:text-[72px] leading-[99%] tracking-[-3%] mt-4">
						Save together. <br className="sm:hidden" /> Get paid automatically.
					</h1>
					<p className="text-sm sm:text-base md:text-xl xl:w-2/3">
						SAJI is the savings platform built for how West Africa actually
						saves community-first, transparent...
					</p>
					<Button className="mt-5" variant="dark">
						Get Started
					</Button>
				</div>
				<div className="z-10 max-md:w-full w1/2 place-self-end">
					<Image
						alt="Hero Image"
						src="/images/hero-bg.svg"
						loading="eager"
						height={1000}
						width={1000}
						className="h-full w-full object-contain"
					/>
				</div>
				<div className="sm:hidden absolute bottom-10 scale-150 rotate-180 rotate-y-180 right-[-60%] z-0">
					<Image
						alt="Hero Image"
						src="/images/vector-2.png"
						height={500}
						width={500}
						loading="eager"
						className="h-full w-full object-contain"
					/>
				</div>
				<div className="absolute z-0 -top-16 -right-16 scale-80 max-lg:hidden">
					<Image
						alt="Hero Image"
						src="/images/vector-2.svg"
						height={500}
						width={500}
						className="h-full w-full object-contain"
					/>
				</div>
				<div className="absolute z-0 -bottom-10 -left-10 ">
					<Image
						alt="Hero Image"
						src="/images/vector-1.svg"
						height={500}
						width={500}
						className="h-full w-full object-contain"
					/>
				</div>
			</div>
		</section>
	);
}
