"use client";
import React, { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { HiMiniBars3 } from "react-icons/hi2";
import { PiArrowsClockwiseBold } from "react-icons/pi";
import { Button } from "../../components/ui/button";
import { pageRoutes } from "../../config/routes";
import { CircleGroup, PayoutRotationMember } from "../../lib/utils/mock-data";
import MemberAvatar from "./MemberAvatar";

const PAYOUT_DATES = ["Oct 15", "Nov 15", "Dec 15", "Jan 15", "Feb 15", "Mar 15", "Apr 15"];

function shuffle<T>(items: T[]): T[] {
	const next = [...items];
	for (let i = next.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[next[i], next[j]] = [next[j], next[i]];
	}
	return next;
}

interface GroupRotationEditorProps {
	group: CircleGroup;
}

export default function GroupRotationEditor({ group }: GroupRotationEditorProps) {
	const router = useRouter();
	const [order, setOrder] = useState<PayoutRotationMember[]>(group.payoutRotation);
	const [showRandomizedModal, setShowRandomizedModal] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const dragIndex = useRef<number | null>(null);

	const handleDragStart = (index: number) => () => {
		dragIndex.current = index;
	};

	const handleDragOver = (e: React.DragEvent) => e.preventDefault();

	const handleDrop = (index: number) => () => {
		const from = dragIndex.current;
		dragIndex.current = null;
		if (from === null || from === index) return;

		setOrder((prev) => {
			const next = [...prev];
			const [moved] = next.splice(from, 1);
			next.splice(index, 0, moved);
			return next;
		});
	};

	const handleRandomize = () => {
		setOrder((prev) => shuffle(prev));
		setShowRandomizedModal(true);
		setTimeout(() => setShowRandomizedModal(false), 1800);
	};

	const handleDiscard = () => {
		router.push(pageRoutes.dashboardRoutes.GROUP(group.id));
	};

	const handleSave = () => {
		setIsSaving(true);
		setTimeout(() => {
			router.push(pageRoutes.dashboardRoutes.GROUP(group.id));
		}, 1000);
	};

	return (
		<div className="mt-4 md:mt-6 relative">
			<h2 className="text-xl md:text-2xl font-semibold text-neutral-dark">
				Who gets paid first?
			</h2>
			<p className="text-xs md:text-sm font-light text-neutral-light-active mt-1.5 max-w-md">
				Drag and drop members to set the sequence. The person at the top
				receives the first collection.
			</p>

			<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5">
				{order.map((member, index) => (
					<div
						key={member.id}
						draggable
						onDragStart={handleDragStart(index)}
						onDragOver={handleDragOver}
						onDrop={handleDrop(index)}
						className={`flex items-center gap-2.5 rounded-[15px] border p-3.5 cursor-grab active:cursor-grabbing transition-colors bg-neutral-comment ${
							index === 0 ? "border-primary" : "border-transparent"
						}`}
					>
						<HiMiniBars3 className="text-neutral-light-active shrink-0" />
						<MemberAvatar name={member.name} isSelf={member.isSelf} colorIndex={index} />
						<div className="min-w-0 flex-1">
							<p className="text-sm font-medium text-neutral-dark truncate">
								{member.name}
							</p>
							<p className="text-xs font-light text-neutral-light-active truncate">
								{member.role}
							</p>
						</div>
						<span
							className={`text-[10px] font-semibold rounded-full px-2.5 py-1 shrink-0 ${
								index === 0
									? "bg-primary text-white"
									: "bg-white text-neutral-light-active"
							}`}
						>
							{(PAYOUT_DATES[index] ?? PAYOUT_DATES[PAYOUT_DATES.length - 1]).toUpperCase()}
						</span>
					</div>
				))}
			</div>

			<button
				type="button"
				onClick={handleRandomize}
				className="w-full flex items-center justify-between gap-4 bg-primary-light rounded-[15px] p-4 mt-4 cursor-pointer border-0 text-left"
			>
				<div>
					<p className="text-sm font-semibold text-primary-darker">Randomize Order</p>
					<p className="text-xs font-light text-primary-dark mt-0.5">
						Shuffle payout sequence for fairness.
					</p>
				</div>
				<span className="w-9 h-9 rounded-full bg-primary flex items-center justify-center shrink-0">
					<PiArrowsClockwiseBold className="text-white text-base" />
				</span>
			</button>

			<div className="flex gap-4 mt-6">
				<Button
					type="button"
					onClick={handleDiscard}
					className="flex-1 bg-neutral-comment text-error-500 font-semibold rounded-full h-12 transition-colors hover:bg-neutral-light border-0 cursor-pointer shadow-none"
				>
					Discard Draft
				</Button>
				<Button
					type="button"
					onClick={handleSave}
					isLoading={isSaving}
					className="flex-1 bg-neutral-dark text-white font-semibold rounded-full h-12 transition-colors hover:bg-neutral-hover cursor-pointer border-0 shadow-none"
				>
					Save &amp; Continue
				</Button>
			</div>

			{showRandomizedModal && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
					<div className="bg-white rounded-[20px] p-8 max-w-xs w-full flex flex-col items-center text-center shadow-xl">
						<span className="w-16 h-16 rounded-full bg-primary flex items-center justify-center">
							<PiArrowsClockwiseBold className="text-white text-2xl" />
						</span>
						<h3 className="text-lg font-semibold text-neutral-dark mt-4">
							Order Randomized
						</h3>
						<p className="text-xs font-light text-neutral-light-active mt-2 leading-relaxed">
							Drag and drop members to set the sequence. The person at the top
							receives the first collection.
						</p>
					</div>
				</div>
			)}
		</div>
	);
}
