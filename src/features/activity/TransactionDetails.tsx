"use client";
import React, { useState } from "react";
import { HiArrowLeft, HiOutlineShare, HiOutlineQuestionMarkCircle } from "react-icons/hi2";
import { FiCheck } from "react-icons/fi";
import { PiDownloadLight } from "react-icons/pi";
import { FaRegCopy } from "react-icons/fa";
import { Transaction } from "./ActivityCard";

interface TransactionDetailsProps {
	tx: Transaction;
	onBack: () => void;
}

export default function TransactionDetails({ tx, onBack }: TransactionDetailsProps) {
	const [copied, setCopied] = useState(false);
	const [shared, setShared] = useState(false);

	const isArrowBanner = tx.type === "withdrawal" || tx.type === "payout";

	const receiptSummary = `${tx.title}\nAmount: ${tx.amount}\nGroup: ${tx.groupName}\nTransaction No: ${tx.txNumber}\nDate: ${tx.date}`;

	const handleCopyTx = (txNumber: string) => {
		navigator.clipboard.writeText(txNumber);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	const handleShare = async () => {
		if (typeof navigator !== "undefined" && "share" in navigator) {
			try {
				await navigator.share({ title: tx.title, text: receiptSummary });
				return;
			} catch {
				// user cancelled or share failed — fall through to clipboard
			}
		}
		navigator.clipboard.writeText(receiptSummary);
		setShared(true);
		setTimeout(() => setShared(false), 2000);
	};

	const handleDownload = () => {
		const blob = new Blob([receiptSummary], { type: "text/plain" });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = `receipt-${tx.txNumber}.txt`;
		link.click();
		URL.revokeObjectURL(url);
	};

	return (
		<div className="space-y-6">
			{/* Back Navigation */}
			<button
				type="button"
				onClick={onBack}
				className="cursor-pointer w-fit flex items-center gap-2 text-neutral-dark hover:opacity-75 transition-opacity bg-transparent border-0 p-0"
			>
				<HiArrowLeft className="text-xl md:text-2xl" />
				<span className="text-sm font-medium">Back</span>
			</button>

			{/* Successful Header */}
			<div className="bg-white border border-neutral-light rounded-[20px] p-5 shadow-sm">
				<div className="flex items-center justify-between">
					<span className="flex items-center gap-2">
						<span className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
							<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4">
								<polyline points="20 6 9 17 4 12" />
							</svg>
						</span>
						<span className="text-sm font-semibold text-neutral-dark">Successful</span>
					</span>
					<div className="flex items-center gap-3 text-neutral-light-active">
						<button
							type="button"
							onClick={handleShare}
							title={shared ? "Copied to clipboard" : "Share receipt"}
							className="hover:text-primary transition-colors cursor-pointer bg-transparent border-0"
						>
							{shared ? <FiCheck className="text-success-600 text-lg" /> : <HiOutlineShare className="text-lg" />}
						</button>
						<button
							type="button"
							onClick={handleDownload}
							title="Download receipt"
							className="hover:text-primary transition-colors cursor-pointer bg-transparent border-0"
						>
							<PiDownloadLight className="text-lg" />
						</button>
						<span className="text-neutral-light-active" title="Help">
							<HiOutlineQuestionMarkCircle className="text-lg" />
						</span>
					</div>
				</div>

				{/* Dynamic Banner Illustration */}
				<div
					className={`w-full rounded-[15px] p-6 mt-4.5 flex items-center justify-between relative overflow-hidden h-35 ${
						isArrowBanner ? "bg-accent-light text-accent" : "bg-primary-light text-primary"
					}`}
				>
					{isArrowBanner ? (
						<>
							{/* Pink Arrow Banner Graphic */}
							<div className="flex flex-col z-10">
								<span className="text-3xl font-extrabold">{tx.amount}</span>
								<span className="text-xs font-light opacity-90 mt-1">Group Funding</span>
							</div>
							<div className="absolute right-4 bottom-2 pointer-events-none scale-[1.2] origin-bottom-right">
								<svg width="100" height="80" viewBox="0 0 100 80" fill="none" xmlns="http://www.w3.org/2000/svg">
									<path d="M10 20C40 20 70 35 80 55" stroke="#FF0084" strokeWidth="10" strokeLinecap="round" />
									<path d="M85 60L60 52M85 60L80 35" stroke="#FF0084" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
								</svg>
							</div>
						</>
					) : (
						<>
							{/* Purple Hand & Target Graphic Banner */}
							<div className="absolute left-4 bottom-2 pointer-events-none scale-[1.1] origin-bottom-left">
								<svg width="60" height="60" viewBox="0 0 60 60" fill="none" xmlns="http://www.w3.org/2000/svg">
									<path d="M0 45C5 43 8 36 12 36H24L18 52H0V45Z" fill="#FBBF24" />
									<path d="M24 36C26 36 29 38 31 40L35 44C37 46 35 49 32 49H20L24 36Z" fill="#FDBA74" />
									<rect x="25" y="24" width="22" height="12" rx="1.5" transform="rotate(-15 25 24)" fill="#34D399" stroke="#059669" strokeWidth="1" />
									<circle cx="34" cy="27" r="2" fill="#059669" />
								</svg>
							</div>
							<div className="flex flex-col items-center justify-center flex-1 z-10 text-center">
								<span className="text-3xl font-extrabold text-primary-darker">{tx.amount}</span>
								<span className="text-xs font-light text-primary-dark mt-1">Group Funding</span>
							</div>
							<div className="absolute right-4 bottom-2 pointer-events-none scale-[1.1] origin-bottom-right">
								<svg width="60" height="60" viewBox="0 0 60 60" fill="none" xmlns="http://www.w3.org/2000/svg">
									<circle cx="30" cy="30" r="24" fill="none" stroke="#4100F4" strokeWidth="3" />
									<circle cx="30" cy="30" r="16" fill="none" stroke="#4100F4" strokeWidth="2.5" />
									<circle cx="30" cy="30" r="8" fill="#4100F4" />
									<path d="M50 10L32 28" stroke="#FF0084" strokeWidth="3" strokeLinecap="round" />
									<path d="M32 28H38V34" fill="#FF0084" />
								</svg>
							</div>
						</>
					)}
				</div>

				{/* Transaction Details Fields */}
				<div className="mt-8 space-y-4">
					<h4 className="text-xs font-light text-neutral-light-active border-b border-neutral-light pb-2.5">
						Transaction Details
					</h4>

					{/* Group Funded */}
					<div className="flex justify-between text-sm py-1">
						<span className="flex items-center gap-2">
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4100F4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
								<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
								<circle cx="9" cy="7" r="4" />
							</svg>
							<span className="font-light text-neutral-light-active">Group Funded</span>
						</span>
						<span className="font-semibold text-neutral-dark">{tx.groupName}</span>
					</div>

					{/* Transaction No */}
					<div className="flex justify-between text-sm py-1">
						<span className="flex items-center gap-2">
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4100F4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
								<rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
								<line x1="3" y1="10" x2="21" y2="10" />
							</svg>
							<span className="font-light text-neutral-light-active">Transaction No.</span>
						</span>
						<span className="font-semibold text-neutral-dark flex items-center gap-1.5 truncate max-w-37.5 sm:max-w-none">
							<span>{tx.txNumber}</span>
							<button
								type="button"
								onClick={() => handleCopyTx(tx.txNumber)}
								className="bg-transparent border-0 cursor-pointer p-0 text-primary hover:text-primary-hover flex items-center justify-center"
							>
								{copied ? (
									<FiCheck className="text-success-600 text-xs transition-transform scale-110" />
								) : (
									<FaRegCopy className="text-xs" />
								)}
							</button>
						</span>
					</div>

					{/* Transaction Date */}
					<div className="flex justify-between text-sm py-1">
						<span className="flex items-center gap-2">
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4100F4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
								<rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
								<line x1="16" y1="2" x2="16" y2="6" />
								<line x1="8" y1="2" x2="8" y2="6" />
								<line x1="3" y1="10" x2="21" y2="10" />
							</svg>
							<span className="font-light text-neutral-light-active">Transaction Date</span>
						</span>
						<span className="font-semibold text-neutral-dark">{tx.date}</span>
					</div>
				</div>

				{/* Action Buttons */}
				<div className="mt-10 pt-2">
					<button
						type="button"
						onClick={handleShare}
						className="w-full bg-primary-darker hover:bg-primary-dark-active text-white font-semibold rounded-full h-12 border-0 cursor-pointer shadow-none transition-colors"
					>
						{shared ? "Copied to Clipboard" : "Share Receipt"}
					</button>
				</div>
			</div>
		</div>
	);
}
