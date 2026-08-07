"use client";
import React, { useState, useMemo, useEffect } from "react";
import StepWizard from "./StepWizard";
import { Button } from "../../../components/ui/button";
import { useCreateGroupStore } from "../../../lib/store/create-group-store";
import { useRouter } from "next/navigation";
import { FiEdit2, FiCheck, FiCopy } from "react-icons/fi";
import { Label } from "../../../components/ui/label";

const Review = () => {
	const store = useCreateGroupStore();
	const router = useRouter();

	const isSuccess = store.groupCreated;
	const [emailInput, setEmailInput] = useState("");
	const [invited, setInvited] = useState<string[]>([
		"sarah@saji.app",
		"deji@saji.app",
		"tariq@saji.app",
	]);
	const [copied, setCopied] = useState(false);

	// Generate a stable invite code for this session (lazy initializer runs once)
	const [inviteCode] = useState(() =>
		Math.random().toString(36).substring(2, 7).toUpperCase(),
	);

	// Group clean URL slug
	const groupSlug = useMemo(() => {
		return store.group_name
			? store.group_name.toLowerCase().replace(/[^a-z0-9]+/g, "")
			: "summerfunds";
	}, [store.group_name]);

	const inviteLink = `saji.app/join/${groupSlug}/${inviteCode}`;

	const handleAddEmail = () => {
		const trimmed = emailInput.trim().toLowerCase();
		if (trimmed && trimmed.includes("@") && !invited.includes(trimmed)) {
			setInvited([...invited, trimmed]);
			setEmailInput("");
		}
	};

	const handleCopy = () => {
		navigator.clipboard.writeText(inviteLink);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	const handleConfirm = () => {
		store.setGroupCreated(true);
	};

	const handleBackHome = () => {
		store.reset();
		router.push("/groups");
	};

	// Object URL for the group photo preview. Creation and revocation must stay
	// paired inside the same effect run — Strict Mode's dev-only mount/unmount/mount
	// otherwise revokes a URL that a render-time useMemo never gets a chance to recreate.
	const [photoPreview, setPhotoPreview] = useState<string | null>(null);

	useEffect(() => {
		if (!store.group_photo) {
			// eslint-disable-next-line react-hooks/set-state-in-effect -- see comment above
			setPhotoPreview(null);
			return;
		}

		const url = URL.createObjectURL(store.group_photo);

		setPhotoPreview(url);
		return () => URL.revokeObjectURL(url);
	}, [store.group_photo]);

	if (isSuccess) {
		return (
			<div className="flex flex-col items-center justify-center py-10 px-4">
				{/* Checkmark Icon Container */}
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

				<h2 className="text-xl font-semibold mt-8 text-neutral-dark text-center">
					Your Savings Group is Active
				</h2>
				<p className="text-xs font-light text-neutral-light-active mt-2.5 max-w-xs text-center leading-relaxed">
					Your group &ldquo;{store.group_name || "Summer Funds"}&rdquo; has been
					successfully created. Now, invite your community to start growing
					together.
				</p>

				{/* Invite link container */}
				<div className="w-full mt-10">
					<Label className="mb-2">Group Invite Link</Label>
					<div className="flex items-center justify-between bg-white border border-neutral-light-hover rounded-full px-5 py-2.5 h-12 shadow-sm">
						<span className="text-sm md:text-base font-light text-neutral-dark truncate select-all pr-4">
							{inviteLink}
						</span>
						<button
							type="button"
							onClick={handleCopy}
							className="text-primary hover:text-primary-hover flex items-center justify-center cursor-pointer"
						>
							{copied ? (
								<FiCheck className="text-success-600 text-lg transition-transform scale-110" />
							) : (
								<FiCopy className="text-lg" />
							)}
						</button>
					</div>
					<p className="text-[10px] font-light text-neutral-light-active mt-2.5">
						Anyone with this link can request to join your group.
					</p>
				</div>

				{/* Back to Home action */}
				<Button
					type="button"
					onClick={handleBackHome}
					className="w-full bg-primary hover:bg-primary-hover text-white font-semibold rounded-full h-12 mt-10 border-0 cursor-pointer shadow-none"
				>
					Back to Home
				</Button>
			</div>
		);
	}

	return (
		<div>
			<StepWizard step={3} />

			<section className="mt-5">
				<h2 className="text-xl font-semibold text-neutral-dark">
					{store.group_name || "Summer Fund"}
				</h2>
			</section>

			{/* Group Photo/Banner */}
			<section className="mt-4">
				{photoPreview ? (
					<div className="h-36 w-full rounded-[15px] relative overflow-hidden bg-neutral-100 border border-neutral-light shadow-sm">
						{/* eslint-disable-next-line @next/next/no-img-element */}
						<img
							src={photoPreview}
							alt="Group Photo"
							className="w-full h-full object-cover"
						/>
						<button
							onClick={() => store.setCurrentStep(1)}
							className="absolute top-3 right-3 bg-white w-7 h-7 rounded-full flex items-center justify-center shadow-md hover:bg-neutral-light cursor-pointer transition-colors border-0"
						>
							<FiEdit2 className="text-neutral-dark text-xs" />
						</button>
					</div>
				) : (
					<div className="h-36 w-full rounded-[15px] bg-linear-to-br from-primary-darker via-primary to-secondary flex items-center justify-center text-white text-lg font-medium relative shadow-md">
						<span className="opacity-95 tracking-wide">
							{store.group_name || "Summer Fund"}
						</span>
						{/* Abstract Tech Globe overlay SVG */}
						<svg
							className="absolute inset-0 w-full h-full object-cover rounded-[15px] opacity-20 pointer-events-none"
							viewBox="0 0 400 150"
							fill="none"
							xmlns="http://www.w3.org/2000/svg"
						>
							<circle
								cx="200"
								cy="75"
								r="45"
								stroke="white"
								strokeWidth="1"
								strokeDasharray="3 3"
							/>
							<circle
								cx="200"
								cy="75"
								r="75"
								stroke="white"
								strokeWidth="0.5"
							/>
							<path d="M100 75H300" stroke="white" strokeWidth="0.5" />
							<path d="M200 15V135" stroke="white" strokeWidth="0.5" />
							<path
								d="M140 30C160 55 160 95 140 120"
								stroke="white"
								strokeWidth="0.5"
								strokeDasharray="2 2"
							/>
							<path
								d="M260 30C240 55 240 95 260 120"
								stroke="white"
								strokeWidth="0.5"
								strokeDasharray="2 2"
							/>
						</svg>
						<button
							onClick={() => store.setCurrentStep(1)}
							className="absolute top-3 right-3 bg-white w-7 h-7 rounded-full flex items-center justify-center shadow-md hover:bg-neutral-light cursor-pointer transition-colors border-0"
						>
							<FiEdit2 className="text-neutral-dark text-xs" />
						</button>
					</div>
				)}
			</section>

			{/* Group Settings Summary Cards */}
			<section className="mt-4">
				<p className="text-xs font-light mb-2.5">Group Settings</p>
				<div className="grid grid-cols-2 gap-4">
					{/* Target Goal */}
					<div className="bg-neutral-comment rounded-[15px] p-4.5 flex flex-col justify-between h-24 shadow-sm border border-neutral-200/50">
						<span className="text-[10px] text-neutral-light-active font-light">
							Target Goal
						</span>
						<div className="flex items-center gap-1.5 mt-1.5">
							<svg
								width="20"
								height="20"
								viewBox="0 0 24 24"
								fill="none"
								xmlns="http://www.w3.org/2000/svg"
							>
								<circle
									cx="12"
									cy="12"
									r="10"
									stroke="#4100F4"
									strokeWidth="2"
								/>
								<circle
									cx="12"
									cy="12"
									r="7"
									stroke="#4100F4"
									strokeWidth="1"
									strokeDasharray="1.5 1.5"
								/>
								<text
									x="8.5"
									y="16"
									fill="#4100F4"
									fontSize="12"
									fontWeight="bold"
								>
									$
								</text>
							</svg>
							<span className="text-lg font-bold text-neutral-dark">
								{Number(store.target_amount || 0).toLocaleString("en-US", {
									minimumFractionDigits: 2,
									maximumFractionDigits: 2,
								})}
							</span>
						</div>
					</div>

					{/* Invited Members count */}
					<div className="bg-neutral-comment rounded-[15px] p-4.5 flex flex-col justify-between h-24 shadow-sm border border-neutral-200/50">
						<span className="text-[10px] text-neutral-light-active font-light">
							{invited.length} Members
						</span>
						<div className="flex items-center gap-0.75 mt-2.5">
							{invited.slice(0, 3).map((email, idx) => {
								const initial = email
									.split("@")[0]
									.substring(0, 2)
									.toUpperCase();
								const colors = [
									"bg-accent-light text-accent border-accent-light-active",
									"bg-secondary-light text-secondary-dark border-secondary-light-active",
									"bg-primary-light text-primary border-primary-light-active",
								];
								return (
									<div
										key={email}
										className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold border ${
											colors[idx % colors.length]
										}`}
									>
										{initial}
									</div>
								);
							})}
							{invited.length > 3 && (
								<div className="w-7 h-7 rounded-full bg-neutral-dark text-white text-[10px] flex items-center justify-center font-semibold border border-neutral-hover">
									+{invited.length - 3}
								</div>
							)}
						</div>
					</div>
				</div>
			</section>

			{/* Overview Table */}
			<section className="mt-6">
				<p className="text-xs mb-1.5">Overview</p>
				<div className="divide-y divide-neutral-light">
					{/* Group Type */}
					<div className="flex justify-between py-3.5 text-sm">
						<span className="flex items-center gap-2">
							<svg
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="#4100F4"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
								<circle cx="9" cy="7" r="4" />
								<path d="M23 21v-2a4 4 0 0 0-3-3.87" />
								<path d="M16 3.13a4 4 0 0 1 0 7.75" />
							</svg>
							<span className="font-light text-neutral-light-active">
								Group Type
							</span>
						</span>
						<span className="font-normal text-neutral-dark">Rotating</span>
					</div>

					{/* Payout Order */}
					<div className="flex justify-between py-3.5 text-sm">
						<span className="flex items-center gap-2">
							<svg
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="#4100F4"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
								<line x1="3" y1="10" x2="21" y2="10" />
							</svg>
							<span className="font-light text-neutral-light-active">
								Payout Order
							</span>
						</span>
						<span className="font-normal text-neutral-dark capitalize">
							{store.payout_order === "random"
								? "Randomized"
								: store.payout_order}
						</span>
					</div>

					{/* Frequency */}
					<div className="flex justify-between py-3.5 text-sm">
						<span className="flex items-center gap-2">
							<svg
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="#4100F4"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
								<line x1="16" y1="2" x2="16" y2="6" />
								<line x1="8" y1="2" x2="8" y2="6" />
								<line x1="3" y1="10" x2="21" y2="10" />
							</svg>
							<span className="font-light text-neutral-light-active">
								Frequency
							</span>
						</span>
						<span className="font-normal text-neutral-dark capitalize">
							{store.contribution_frequency === "biweekly"
								? "Bi-Weekly"
								: store.contribution_frequency}
						</span>
					</div>

					{/* Service Charge */}
					<div className="flex justify-between py-3.5 text-sm">
						<span className="flex items-center gap-2">
							<svg
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="#4100F4"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<circle cx="12" cy="12" r="10" />
								<path d="M12 8v8" />
								<path d="M8 12h8" />
							</svg>
							<span className="font-light text-neutral-light-active">
								Service Charge
							</span>
						</span>
						<span className="font-normal text-neutral-dark">
							{store.service_charge || 0}%
						</span>
					</div>

					{/* Late Penalty */}
					<div className="flex justify-between py-3.5 text-sm">
						<span className="flex items-center gap-2">
							<svg
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="#FF0000"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<circle cx="12" cy="12" r="10" />
								<line x1="12" y1="16" x2="12" y2="12" />
								<line x1="12" y1="8" x2="12.01" y2="8" />
							</svg>
							<span className="font-light text-[#FF0000] md:font-medium">
								Late Penalty
							</span>
						</span>
						<span className="font-normal text-[#FF0000]">
							{store.late_fee_percentage || 0}% after {store.grace_period || 0}{" "}
							days
						</span>
					</div>
				</div>
			</section>

			{/* Invited Members tags card */}
			<section className="mt-6">
				<div className="bg-neutral-comment rounded-[15px] p-5 shadow-sm border border-neutral-200/50">
					<h3 className="text-sm font-semibold text-neutral-dark">
						Invited Members
					</h3>
					<p className="text-[10px] font-light text-neutral-light-active mt-1.5 leading-normal">
						Invitation links will be sent once the group is created &amp;
						finalized, added members will also be notified to confirm their
						addition.
					</p>

					{/* Scrollable list of invited emails */}
					{invited.length > 0 ? (
						<div className="flex flex-wrap gap-2 mt-4.5 max-h-36 overflow-y-auto scroll">
							{invited.map((email) => {
								return (
									<div
										key={email}
										className="flex items-center gap-1.5 bg-white border border-neutral-light rounded-full pl-3 pr-1.5 py-1 text-[11px] shadow-sm"
									>
										<span className="font-light text-neutral-dark truncate max-w-37.5">
											{email}
										</span>
										<button
											type="button"
											onClick={() =>
												setInvited(invited.filter((e) => e !== email))
											}
											className="w-4 h-4 rounded-full flex items-center justify-center bg-neutral-light hover:bg-error-50 hover:text-error-500 cursor-pointer text-[10px] border-0 transition-colors"
										>
											&times;
										</button>
									</div>
								);
							})}
						</div>
					) : (
						<p className="text-[11px] font-light text-neutral-light-active mt-4.5 italic text-center py-2">
							No members invited yet. Add their emails below!
						</p>
					)}

					{/* Add Email input form */}
					<div className="flex gap-2 mt-4.5">
						<input
							type="email"
							value={emailInput}
							onChange={(e) => setEmailInput(e.target.value)}
							placeholder="friend@saji.app"
							className="flex-1 bg-white rounded-full px-4.5 py-2 text-xs outline-none border border-neutral-light-active focus:border-primary placeholder:text-neutral-light-active shadow-sm"
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.preventDefault();
									handleAddEmail();
								}
							}}
						/>
						<button
							type="button"
							onClick={handleAddEmail}
							className="bg-primary text-white text-xs font-semibold px-5 py-2.5 rounded-full cursor-pointer hover:bg-primary-hover border-0 shadow-sm transition-colors"
						>
							Add
						</button>
					</div>
				</div>
			</section>

			{/* Confirm and Create button */}
			<section className="mt-8 pt-2">
				<Button
					type="button"
					onClick={handleConfirm}
					className="w-full bg-primary hover:bg-primary-hover text-white font-semibold rounded-full h-12 border-0 cursor-pointer shadow-none"
				>
					Confirm &amp; Create
				</Button>
			</section>
		</div>
	);
};

export default Review;
