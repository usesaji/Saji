/* eslint-disable react-hooks/refs */
"use client";

import Image from "next/image";
import useEmblaCarousel from "embla-carousel-react";
import Autoplay from "embla-carousel-autoplay";
import {
	IoIosArrowDropleftCircle,
	IoIosArrowDroprightCircle,
} from "react-icons/io";
import { useCallback, useRef } from "react";

const reviews = [
	{
		id: 1,
		text: "I have been using WordPress for a while but some of the things you have shared in Week 1 alone have been eye-opening.",
		name: "Sophia Williams",
		handle: "@sophiewillis",
		image: "/images/user.jpg",
	},
	{
		id: 2,
		text: "This program gave me a clearer direction on how to package my skills and position myself better online.",
		name: "Daniel Peters",
		handle: "@danielpeters",
		image: "/images/user.jpg",
	},
	{
		id: 3,
		text: "I didn’t expect to get this much value so early. The sessions have been practical and very easy to follow.",
		name: "Adaeze James",
		handle: "@adajames",
		image: "/images/user.jpg",
	},
	{
		id: 4,
		text: "Everything was explained in a way that made sense immediately. I’ve already started applying some of it to my business.",
		name: "Michael Cole",
		handle: "@michaelcole",
		image: "/images/user.jpg",
	},
	{
		id: 5,
		text: "The lessons are clear, actionable, and not filled with fluff. I’ve learned more here than in a lot of random tutorials.",
		name: "Ruth Johnson",
		handle: "@ruthjohnson",
		image: "/images/user.jpg",
	},
	{
		id: 6,
		text: "This has honestly helped me organize what I already knew and turn it into something more useful and marketable.",
		name: "David Brown",
		handle: "@davidbrown",
		image: "/images/user.jpg",
	},
];

const ReviewCard = ({
	text,
	name,
	handle,
	image,
}: {
	text: string;
	name: string;
	handle: string;
	image: string;
}) => {
	return (
		<div className="h-56 lg:max-w-110 place-self-end rounded-2xl bg-neutral-comment px-6.25 py-7.25 flex flex-col justify-between">
			<div>
				<p>{text}</p>
			</div>

			<div className="flex items-center gap-3.5">
				<div className="h-15.5 w-15.5 overflow-hidden rounded-full">
					<Image
						alt={name}
						src={image}
						width={300}
						height={300}
						className="h-full w-full object-cover object-center"
					/>
				</div>

				<div>
					<h4>{name}</h4>
					<p className="text-xs">{handle}</p>
				</div>
			</div>
		</div>
	);
};

const Reviews = () => {
	const autoplay = useRef(
		Autoplay({
			delay: 3000,
			stopOnInteraction: false,
			stopOnMouseEnter: true,
		}),
	);

	const [emblaRef, emblaApi] = useEmblaCarousel(
		{
			loop: true,
			align: "start",
			slidesToScroll: 1,
		},
		[autoplay.current],
	);

	const scrollPrev = useCallback(() => {
		emblaApi?.scrollPrev();
		autoplay.current?.reset();
	}, [emblaApi]);

	const scrollNext = useCallback(() => {
		emblaApi?.scrollNext();
		autoplay.current?.reset();
	}, [emblaApi]);

	return (
		<section className="pt-10 lg:pt-14">
			<div className="custom-container flex flex-col gap-5 lg:flex-row lg:justify-between lg:gap-30">
				<div className="shrink-0">
					<h2 className="landing-h2">Reviews</h2>

					<div className="mt-3.5 w-40">
						<Image
							alt="images of users"
							src="/images/hero-user-imgs.svg"
							className="w-full object-contain"
							height={100}
							width={100}
						/>
					</div>
				</div>

				<div className="min-w-0 flex-1">
					<div className="overflow-hidden" ref={emblaRef}>
						<div className="-ml-4 flex">
							{reviews.map((review) => (
								<div
									key={review.id}
									className="min-w-0 shrink-0 basis-full pl-4 md:basis-1/2"
								>
									<ReviewCard
										text={review.text}
										name={review.name}
										handle={review.handle}
										image={review.image}
									/>
								</div>
							))}
						</div>
					</div>

					<div className="cursor-pointer mt-4.5 flex items-center gap-2.5 text-[40px] text-primary hover:text-primary-hover md:text-[56px] lg:justify-end">
						<button
							type="button"
							onClick={scrollPrev}
							aria-label="Previous review"
							className="transition-transform hover:scale-105"
						>
							<IoIosArrowDropleftCircle />
						</button>

						<button
							type="button"
							onClick={scrollNext}
							aria-label="Next review"
							className="transition-transform hover:scale-105"
						>
							<IoIosArrowDroprightCircle />
						</button>
					</div>
				</div>
			</div>
		</section>
	);
};

export default Reviews;
