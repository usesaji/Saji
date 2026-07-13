import React from "react";
import { Button } from "../ui/button";
import Image from "next/image";

const Cta = () => {
	return (
		<section className="custom-container pt-8 lg:pt-10">
			<div className=" bg-primary-light rounded-[40px] px-4.5 pt-9.5 lg:px-10 lg:py-12 overflow-hidden sm:flex md:gap-10 max-h-138 lg:gap-20">
				<div className="sm:flex-1/2 md:flex md:justify-between md:flex-col">
					<div>
						<h2 className="landing-h2">The Ajo your group deserves</h2>

						<p className="text-[#484848] text-sm font-light mt-3.5 lg:mt-6 leading-[123%] mb-5 lg:mb-10 lg:text-xl">
							SAJI is the savings platform built for how West Africa actually
							saves community-first, transparent, and fraud-proof.
						</p>
					</div>

					<div className="space-x-4 mb-12.75 lg:mb-0 md:mt-10">
						<Button variant="default" className="">
							Get Started
						</Button>
						<Button variant="dark" className="">
							Learn More
						</Button>
					</div>
				</div>

				<div className="z-10 max-md:w-full w-1/2 place-self-end mb-[-100] lg:mb-[-300] sm:flex-1/2">
					<Image
						alt="Hero Image"
						src="/images/cta-bg.svg"
						height={1000}
						width={1000}
						className="h-full w-full object-contain"
					/>
				</div>
			</div>
		</section>
	);
};

export default Cta;
