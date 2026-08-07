import React from "react";
import { Button } from "../../components/ui/button";

interface TransactionSuccessScreenProps {
	heading: string;
	description: string;
	amount?: string;
	buttonLabel: string;
	onButtonClick: () => void;
}

export default function TransactionSuccessScreen({
	heading,
	description,
	amount,
	buttonLabel,
	onButtonClick,
}: TransactionSuccessScreenProps) {
	return (
		<div className="flex flex-col items-center justify-center py-10 px-4">
			<div className="w-24 h-24 bg-primary rounded-full flex items-center justify-center shadow-lg shadow-primary/25 mt-6 transition-transform duration-300 hover:scale-105">
				<svg
					width="36"
					height="36"
					viewBox="0 0 24 24"
					fill="none"
					stroke="white"
					strokeWidth="4"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<polyline points="20 6 9 17 4 12" />
				</svg>
			</div>

			{amount && (
				<h3 className="text-3xl md:text-4xl font-bold text-neutral-dark mt-6">
					{amount}
				</h3>
			)}

			<h2 className="text-xl font-semibold mt-4 text-neutral-dark text-center">
				{heading}
			</h2>
			<p className="text-xs font-light text-neutral-light-active mt-2.5 max-w-xs text-center leading-relaxed">
				{description}
			</p>

			<Button
				type="button"
				onClick={onButtonClick}
				className="w-full bg-primary hover:bg-primary-hover text-white font-semibold rounded-full h-12 mt-10 border-0 cursor-pointer shadow-none"
			>
				{buttonLabel}
			</Button>
		</div>
	);
}
