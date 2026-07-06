import React from "react";
import { Button } from "../ui/button";
import { FiPlus } from "react-icons/fi";

const FaqList = () => {
	return (
		<div>
			<div className="flex justify-between bg-neutral-comment hover:bg-primary-dark-hover hover:text-white duration-150 cursor-pointer py-4 px-5 lg:py-5 lg:px-8 rounded-[46px] items-center">
				<p className="lg:text-2xl">The structure of a website</p>
				<FiPlus className="text-2xl" />
			</div>
		</div>
	);
};

const Faq = () => {
	return (
		<section className="pt-18.5 pb-12 lg:pt-29 lg:pb-16">
			<div className="custom-container flex flex-col gap-6.5 md:justify-between md:gap-10 md:flex-row lg:gap-20">
				<div className="sm:flex-1/2">
					<h2 className="text-[42px] leading-[99%] lg:text-[52px]">
						Frequently Asked Questions.
					</h2>
					<p className="text-[#484848] font-light mt-3.5 lg:mt-6 leading-[123%] mb-5 lg:mb-10 lg:text-xl">
						SAJI is the savings platform built for how West Africa actually
						saves community-first, transparent, and fraud-proof.
					</p>
					<Button>Get Started</Button>
				</div>
				<div className="space-y-2.5 flex-1/2 lg:space-y-4.5">
					<FaqList />
					<FaqList />
					<FaqList />
					<FaqList />
					<FaqList />
				</div>
			</div>
		</section>
	);
};

export default Faq;
