"use client";
import Image from "next/image";
import { Button } from "../ui/button";

const Stats = () => {
	const stats = [
		{
			label: "Total Saved Collectively",
			value: "₦25.9M",
		},
		{
			label: "Active Circles",
			value: "850+",
		},
		{
			label: "Trust Completion Rate",
			value: "99.9%",
		},
		{
			label: "Countries Supported",
			value: "145+",
		},
	];
	return (
		<div className="grid grid-cols-2 gap-5.5 md:grid-cols-4 sm:gap-8">
			{stats.map((stat, index) => (
				<div
					key={index}
					className="text-center flex flex-col items-center place-self-center w-full"
				>
					<h3 className="text-[36px] sm:text-[48px] md:text-[52px] xl:text-[74px] text-primary-dark-active">
						{stat.value}
					</h3>
					<p className="font-light text-sm sm:text-base -mt-2 whitespace-nowrap">
						{stat.label}
					</p>
				</div>
			))}
		</div>
	);
};

const About = () => {
	return (
		<section>
			<div className="custom-container py-13 sm:py-20 lg:py-22">
				<Stats />
			</div>

			<div className="custom-container">
				<div className="rounded-[20px] bg-neutral-comment sm:flex lg:w-8/12 sm:justify-between sm:gap-13.25 pt-8.75 px-5.5 sm:pt-14.5 sm:pl-14 sm:pr-10.5 sm:rounded-[30px] max-sm:max-h-130.25 max-h-125.25 overflow-hidden">
					<div className="sm:w-1/2 flex flex-col justify-between pb-10">
						<div>
							<h3 className="text-primary-dark-active text-[32px] md:text-[42px] leading-[99%]">
								Build Your Circle In Minutes
							</h3>
							<p className="mt-4 sm:mt-5">
								Contribute your way, see who&apos;s paid, and receive your
								payout
							</p>
						</div>
						<Button variant="dark" className="mt-5">
							Learn More
						</Button>
					</div>
					<div className="sm:w-1/2">
						<Image
							alt="Build your circle"
							src="/images/about/build-circle.png"
							height={500}
							width={500}
							className="object-contain h-full w-full"
						/>
					</div>
				</div>
				<div>1</div>
				<div>1</div>
				<div>1</div>
			</div>
		</section>
	);
};

export default About;
