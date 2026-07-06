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

			<div className="custom-container grid grid-cols-1 lg:grid-cols-12 gap-x-6 gap-y-5 sm:gap-y-7.5">
				{/* Build Your Circle */}
				<div className="rounded-[20px] bg-neutral-comment sm:flex lg:col-span-7 sm:justify-between gap-6 xl:gap-0 pt-8.75 px-5.5 sm:pt-14.5 md:pl-10  xl:pl-14 sm:pr-8 sm:rounded-[30px] max-sm:max-h-130.25 max-h-110.25 overflow-hidden">
					<div className="sm:w-1/2 flex flex-col justify-between pb-10">
						<div>
							<h3 className="text-primary-dark-active text-[32px] md:text-[42px] leading-[99%]">
								Build Your Circle In Minutes
							</h3>
							<p className="mt-4 sm:mt-5 w-4/5">
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
				{/* Withdraw in minutes */}
				<div className="rounded-[20px] bg-neutral-comment flex flex-col lg:col-span-5 sm:justify-between pt-8.75 sm:pt-14.5 sm:pl-14 sm:pr-8 sm:rounded-[30px] max-sm:max-h-130.25 max-h-110.25 overflow-hidden">
					<div className="flex flex-col justify-between pb-5 sm:pb-10 px-5.5">
						<div>
							<h3 className="text-primary-dark-active text-[32px] md:text-[42px] leading-[99%]">
								Withdraw In Minutes
							</h3>
							<p className="mt-4 sm:mt-5 w-2/3">
								Contribute your way, see who&apos;s paid, and receive your
								payout
							</p>
						</div>
					</div>
					<div className="flex items-end relative justify-between max-sm:flex-col max-sm:items-start">
						<Button
							variant="default"
							className="sm:mt-5 mb-10 w-fit max-sm:mx-5.5 "
						>
							Get Started
						</Button>
						<div className="max-sm:mx-auto max-sm:-mb-6 max-sm:justify-self-centers lg:absolute right-0 -bottom-1 lg:right-[-50%] h-60 lg:h-50 xl:h-63.5">
							<Image
								alt="Withdraw in minutes"
								src="/images/about/withdraw.png"
								height={500}
								width={500}
								className="object-contain h-full w-full"
							/>
						</div>
					</div>
				</div>

				{/* Backed by Blockchain */}
				<div className="rounded-[20px] bg-neutral-comment flex flex-col lg:col-span-5 sm:justify-between pt-8.75 sm:pt-10 sm:pr-8 sm:rounded-[30px] max-sm:max-h-130.25 max-h-110.25 overflow-hidden">
					<div className="flex flex-col justify-between pb-5 sm:pb-10 px-5.5">
						<div>
							<h3 className="text-primary-dark-active text-[32px] md:text-[42px] leading-[99%]">
								Backed by blockchain.
							</h3>
							<p className="mt-4 sm:mt-3">
								Every contribution recorded. Every payout automated. No
								coordinator to trust.
							</p>
						</div>
					</div>
					<div className="flex items-end relative justify-between max-sm:flex-col max-sm:items-start">
						<Button variant="default" className="sm:mt-5 mb-10 w-fit mx-5.5 ">
							Get Started
						</Button>
						<div className="max-sm:mx-auto max-sm:-mb-6 max-sm:justify-self-centers lg:absolute right-0 -bottom-10 lg:right-[-10%] h-60 lg:h-50 xl:h-63.5">
							<Image
								alt="Backed By Blockchain"
								src="/images/about/backed.png"
								height={500}
								width={500}
								className="object-contain h-full w-full"
							/>
						</div>
					</div>
				</div>

				{/* Saving African Style */}
				<div className="rounded-[20px] bg-neutral-comment sm:flex lg:col-span-7 sm:justify-between gap-6 xl:gap-0 pt-8.75 px-5.5 sm:pt-14.5 md:pl-10  xl:pl-14 sm:pr-8 sm:rounded-[30px] max-sm:max-h-130.25 max-h-110.25 overflow-hidden">
					<div className="sm:w-1/2 flex flex-col justify-between pb-10">
						<div>
							<h3 className="text-primary-dark-active text-[32px] md:text-[42px] leading-[99%]">
								Save the west African Way
							</h3>
							<p className="mt-4 sm:mt-5 w-4/5">
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
							alt="Save the african style"
							src="/images/about/native-drum.png"
							height={500}
							width={500}
							className="object-contain h-full w-full"
						/>
					</div>
				</div>
			</div>
		</section>
	);
};

export default About;
