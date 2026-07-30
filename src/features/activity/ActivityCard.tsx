"use client";
import React from "react";
import { IoIosArrowRoundForward } from "react-icons/io";

export interface Transaction {
	id: string;
	title: string;
	time: string;
	date: string;
	description: string;
	amount: string;
	type: "contribution" | "payout" | "withdrawal";
	groupName: string;
	txNumber: string;
}

interface ActivityCardProps {
	tx: Transaction;
	onViewDetails: (tx: Transaction) => void;
}

const ActivityCard: React.FC<ActivityCardProps> = ({ tx, onViewDetails }) => {
	// Decide theme based on transaction type
	const getIconTheme = () => {
		switch (tx?.type) {
			case "withdrawal":
				return {
					bg: "bg-accent-light", // #FFE6F3
					fill: "#FF0084",
					svg: (
						<path
							d="M22.6812 13.5006C22.2277 13.3418 21.5917 13.4955 21.2607 13.8436L16.7278 18.6104C16.3968 18.9585 16.496 19.3693 16.9494 19.5282L27.7254 23.3004C28.1789 23.4591 28.8147 23.3056 29.1459 22.9575L33.6788 18.1907C34.0098 17.8424 33.9106 17.4316 33.4572 17.2729L22.6812 13.5006Z"
							fill="#FF0084"
						/>
					),
				};
			case "payout":
				return {
					bg: "bg-secondary-light", // #f1fdff
					fill: "#59aebf",
					svg: (
						<path
							d="M25 15l-8 8h16l-8-8z"
							fill="#59aebf"
							transform="rotate(180 25 25)"
						/>
					),
				};
			case "contribution":
			default:
				return {
					bg: "bg-primary-light", // #ece6fe
					fill: "#4100F5",
					svg: (
						<circle
							cx="23.5"
							cy="23.5"
							r="10"
							stroke="#4100F4"
							strokeWidth="2.5"
						/>
					),
				};
		}
	};

	const theme = getIconTheme();

	return (
		<div className="bg-[#f8f8f8] hover:border-accent rounded-xl py-4 px-3 md:py-5 md:px-6 transition-colors border border-neutral-200/20">
			<div className="flex items-start gap-3">
				<div
					className={`rounded-full w-12 h-12 flex items-center justify-center shrink-0 ${theme.bg}`}
				>
					<svg
						className="scale-[0.85]"
						width="48"
						height="48"
						viewBox="0 0 48 48"
						fill="none"
						xmlns="http://www.w3.org/2000/svg"
					>
						<rect
							width="47.0553"
							height="47.0553"
							rx="23.5277"
							fill="transparent"
						/>
						{theme.svg}
						{tx?.type === "withdrawal" && (
							<path
								d="M21.3784 22.9897C20.925 22.8308 20.289 22.9844 19.958 23.3325L15.4251 28.0994C15.0941 28.4475 15.1932 28.8584 15.6466 29.017L26.4227 32.7893C26.8761 32.9481 27.512 32.7946 27.8431 32.4464L32.3759 27.6795C32.707 27.3314 32.6077 26.9206 32.1543 26.7618L21.3784 22.9897Z"
								fill="#FF0084"
							/>
						)}
					</svg>
				</div>

				<div className="flex-1 min-w-0">
					<h5 className="flex gap-3 items-center justify-between">
						<span className="text-sm font-medium text-neutral-dark truncate">
							{tx?.title}
						</span>
						<span className="text-[10px] text-neutral-light-active font-light shrink-0">
							{tx?.time}
						</span>
					</h5>

					<p className="text-xs text-neutral-light-active font-light leading-normal mt-1.5 line-clamp-2 md:line-clamp-none">
						{tx?.description}
					</p>

					<button
						type="button"
						onClick={() => onViewDetails(tx)}
						className="flex items-center text-primary font-medium mt-3 bg-transparent border-0 cursor-pointer p-0 text-xs hover:opacity-75 transition-opacity"
					>
						<span>View Transaction</span>
						<IoIosArrowRoundForward className="text-lg" />
					</button>
				</div>
			</div>
		</div>
	);
};

export default ActivityCard;
