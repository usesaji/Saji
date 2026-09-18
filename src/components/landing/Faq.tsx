"use client";

import { useState } from "react";
import { Button } from "../ui/button";
import { FiPlus } from "react-icons/fi";
// import { FiMinus } from "react-icons/fi";

const faqs = [
	{
		id: 1,
		question: "The structure of a website",
		answer:
			"A savings circle (also known as Ajo, Esusu, or Adashe in different parts of Nigeria) is a traditional group savings system where a small number of people come together and contribute a fixed amount of money at regular intervals — weekly or monthly. Each.",
	},
	{
		id: 2,
		question: "How secure is my money?",
		answer:
			"Your contributions are protected through transparent record keeping and secure payment infrastructure, ensuring every transaction is accounted for.",
	},
	{
		id: 3,
		question: "Can I withdraw anytime?",
		answer:
			"Withdrawal depends on the savings plan you've joined. Some plans allow flexible withdrawals while rotational circles follow their agreed schedule.",
	},
	{
		id: 4,
		question: "How do I join a savings group?",
		answer:
			"You can create your own group or receive an invitation from an existing member. The onboarding process only takes a few minutes.",
	},
	{
		id: 5,
		question: "Are there any hidden charges?",
		answer: "No. Every fee is shown upfront before you make any payment.",
	},
];

type FaqItemProps = {
	id: number;
	question: string;
	answer: string;
	isOpen: boolean;
	onToggle: (id: number) => void;
};

const FaqItem = ({ id, question, answer, isOpen, onToggle }: FaqItemProps) => {
	return (
		<div className="space-y-2.5 lg:space-y-4.5">
			<button
				onClick={() => onToggle(id)}
				className="w-full flex justify-between bg-neutral-comment hover:bg-primary-dark-hover hover:text-white duration-300 cursor-pointer py-4 px-5 lg:py-5 lg:px-8 rounded-[46px] items-center"
			>
				<p className="lg:text-2xl text-left font-light">{question}</p>

				<div className={`duration-300 ${isOpen ? "rotate-45" : "rotate-0"}`}>
					<FiPlus className="text-2xl shrink-0" />
				</div>
			</button>

			<div
				className={`grid transition-all duration-500 ease-in-out ${
					isOpen
						? "grid-rows-[1fr] opacity-100 mb-6"
						: "grid-rows-[0fr] opacity-0"
				}`}
			>
				<div className="overflow-hidden">
					<div className="bg-neutral-comment rounded-[15px] py-6 px-5 lg:px-9 font-light">
						{answer}
					</div>
				</div>
			</div>
		</div>
	);
};

const Faq = () => {
	const [openId, setOpenId] = useState<number | null>(1);

	const handleToggle = (id: number) => {
		setOpenId((prev) => (prev === id ? null : id));
	};

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

				<div className="flex-1/2 ">
					{faqs.map((faq) => (
						<FaqItem
							key={faq.id}
							{...faq}
							isOpen={openId === faq.id}
							onToggle={handleToggle}
						/>
					))}
				</div>
			</div>
		</section>
	);
};

export default Faq;
