import React from "react";
import { PiWarningOctagonFill } from "react-icons/pi";
import { IoClose } from "react-icons/io5";

interface TransactionErrorBannerProps {
	title: string;
	message: string;
	onDismiss?: () => void;
}

export default function TransactionErrorBanner({
	title,
	message,
	onDismiss,
}: TransactionErrorBannerProps) {
	return (
		<div className="bg-error-50 rounded-[20px] p-5 flex items-center gap-4 relative overflow-hidden">
			<div className="min-w-0 flex-1">
				<h4 className="text-sm font-semibold text-error-600">{title}</h4>
				<p className="text-xs font-light text-error-500 mt-1.5 leading-relaxed">
					{message}
				</p>
			</div>

			<PiWarningOctagonFill className="text-error-300/70 text-5xl md:text-6xl shrink-0" />

			{onDismiss && (
				<button
					type="button"
					onClick={onDismiss}
					className="absolute top-3 right-3 text-error-500 hover:text-error-600 cursor-pointer bg-transparent border-0"
				>
					<IoClose className="text-lg" />
				</button>
			)}
		</div>
	);
}
