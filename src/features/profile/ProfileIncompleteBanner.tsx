"use client";
import React from "react";
import { HiXMark } from "react-icons/hi2";

interface ProfileIncompleteBannerProps {
	percentComplete: number;
	onDismiss: () => void;
}

export default function ProfileIncompleteBanner({
	percentComplete,
	onDismiss,
}: ProfileIncompleteBannerProps) {
	return (
		<div className="bg-primary-light rounded-[20px] p-5 relative">
			<button
				type="button"
				onClick={onDismiss}
				className="absolute top-4 right-4 text-primary-dark hover:text-primary-darker cursor-pointer bg-transparent border-0"
			>
				<HiXMark className="text-base" />
			</button>

			<h4 className="text-sm font-semibold text-primary-darker pr-6">
				Your Profile is {percentComplete}% Incomplete
			</h4>
			<p className="text-xs font-light text-primary-dark mt-1">
				Complete your profile for the full experience
			</p>

			<div className="h-1.75 bg-white rounded-[900px] mt-3">
				<div
					className="bg-primary rounded-[900px] h-1.75 transition-all"
					style={{ width: `${percentComplete}%` }}
				/>
			</div>
		</div>
	);
}
