"use client";
import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FiCheck, FiCopy } from "react-icons/fi";
import GoBack from "../../components/dashboard/GoBack";
import { Button } from "../../components/ui/button";
import { pageRoutes } from "../../config/routes";
import { CircleGroup } from "../../lib/utils/mock-data";
import TransactionSuccessScreen from "../wallet/TransactionSuccessScreen";

interface InviteMembersFormProps {
	group: CircleGroup;
}

type Status = "idle" | "sending" | "sent";

export default function InviteMembersForm({ group }: InviteMembersFormProps) {
	const router = useRouter();
	const [emailInput, setEmailInput] = useState("");
	const [invited, setInvited] = useState<string[]>([]);
	const [copied, setCopied] = useState(false);
	const [status, setStatus] = useState<Status>("idle");

	const groupSlug = useMemo(
		() => group.title.toLowerCase().replace(/[^a-z0-9]+/g, ""),
		[group.title],
	);
	const inviteLink = `saji.app/join/${groupSlug}`;

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

	const handleSendInvites = () => {
		if (invited.length === 0) return;
		setStatus("sending");
		setTimeout(() => setStatus("sent"), 1200);
	};

	const handleBackToGroup = () => {
		router.push(pageRoutes.dashboardRoutes.GROUP(group.id));
	};

	if (status === "sent") {
		return (
			<TransactionSuccessScreen
				heading="Invites Sent"
				description={`${invited.length} invite${invited.length === 1 ? "" : "s"} sent to join ${group.title}. They'll be notified by email.`}
				buttonLabel="Back to Group"
				onButtonClick={handleBackToGroup}
			/>
		);
	}

	return (
		<div className="mx-auto md:max-w-xl lg:max-w-2xl w-full px-0 sm:px-4 py-2">
			<div className="space-y-6">
				<GoBack />

				<h2 className="text-xl font-semibold text-neutral-dark">
					Invite Members to {group.title}
				</h2>

				{group.visibility === "private" && (
					<p className="text-xs font-light text-neutral-light-active -mt-4">
						This is a private group — only people you invite can join.
					</p>
				)}

				{/* Invite link */}
				<div>
					<label className="text-xs font-light text-neutral-light-active mb-2 block">
						Group Invite Link
					</label>
					<div className="flex items-center justify-between bg-neutral-comment rounded-full px-5 py-2.5 h-12">
						<span className="text-xs md:text-sm font-light text-neutral-dark truncate select-all pr-4">
							{inviteLink}
						</span>
						<button
							type="button"
							onClick={handleCopy}
							className="text-primary hover:text-primary-hover flex items-center justify-center cursor-pointer bg-transparent border-0 shrink-0"
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

				{/* Invite by email */}
				<div className="bg-neutral-comment rounded-[15px] p-5">
					<h3 className="text-sm font-semibold text-neutral-dark">Invite by Email</h3>
					<p className="text-[10px] font-light text-neutral-light-active mt-1.5 leading-normal">
						Invited members will be notified by email to confirm their addition.
					</p>

					{invited.length > 0 && (
						<div className="flex flex-wrap gap-2 mt-4.5">
							{invited.map((email) => (
								<div
									key={email}
									className="flex items-center gap-1.5 bg-white border border-neutral-light rounded-full pl-3 pr-1.5 py-1 text-[11px] shadow-sm"
								>
									<span className="font-light text-neutral-dark truncate max-w-37.5">
										{email}
									</span>
									<button
										type="button"
										onClick={() => setInvited(invited.filter((e) => e !== email))}
										className="w-4 h-4 rounded-full flex items-center justify-center bg-neutral-light hover:bg-error-50 hover:text-error-500 cursor-pointer text-[10px] border-0 transition-colors"
									>
										&times;
									</button>
								</div>
							))}
						</div>
					)}

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

				<Button
					type="button"
					onClick={handleSendInvites}
					disabled={invited.length === 0}
					isLoading={status === "sending"}
					className="w-full bg-primary hover:bg-primary-hover text-white font-semibold rounded-full h-12 border-0 cursor-pointer shadow-none"
				>
					Send {invited.length > 0 ? invited.length : ""} Invite
					{invited.length === 1 ? "" : "s"}
				</Button>
			</div>
		</div>
	);
}
