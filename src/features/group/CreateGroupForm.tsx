"use client";

/* eslint-disable @next/next/no-img-element */
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
	HiOutlineArrowsRightLeft,
	HiOutlineClipboardDocument,
	HiCheck,
	HiMinus,
	HiPlus,
} from "react-icons/hi2";
import { FaShuffle, FaHandPointer, FaCheckToSlot, FaGear } from "react-icons/fa6";
import { RiMoneyDollarCircleFill } from "react-icons/ri";
import { PiWarningCircleFill } from "react-icons/pi";
import InputField from "../../components/ui/custom/InputField";
import { Button } from "../../components/ui/button";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "../../components/ui/select";
import { Label } from "../../components/ui/label";
import {
	groups as groupsApi,
	fieldErrors,
	ApiError,
	type CreateGroupInput,
} from "../../lib/api";
import { pageRoutes } from "../../config/routes";
import { toast } from "../../lib/utils/toast";
import { useSavingsContract } from "../../lib/hooks/useSavingsContract";
import { TOKEN_LIST, tokenFor } from "../../lib/contract/tokens";
import { labelize } from "./group-view";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

const FREQUENCIES = [
	{ value: "daily", label: "Daily" },
	{ value: "weekly", label: "Weekly" },
	{ value: "bi_weekly", label: "Bi-Weekly" },
	{ value: "monthly", label: "Monthly" },
	{ value: "custom", label: "Custom" },
];
const GROUP_TYPES = [
	{ value: "private", label: "Private" },
	{ value: "public", label: "Public" },
];
const LATE_PENALTIES = [
	{ value: "deduct_from_balance", label: "Deduct from balance" },
	{ value: "remove_member", label: "Remove member" },
];
const PAYOUT_TILES = [
	{ value: "random", label: "Random", Icon: FaShuffle },
	{ value: "manual", label: "Manual", Icon: FaHandPointer },
	{ value: "vote", label: "Vote", Icon: FaCheckToSlot },
	{ value: "custom", label: "Custom", Icon: FaGear },
];

type FormState = {
	name: string;
	description: string;
	contribution_amount: string;
	target_amount: string;
	asset_code: string;
	contribution_frequency: string;
	cycle_length_days: string;
	payout_order: string;
	group_type: string;
	late_penalty: string;
	/** Service charge as a PERCENT (converted to bps on submit). */
	service_pct: string;
	/** Late fee as a PERCENT (converted to bps on submit). */
	late_pct: string;
	/** Grace period in DAYS (converted to hours on submit). */
	grace_days: string;
	auto_approve_join: boolean;
	hide_balances: boolean;
};

const initial: FormState = {
	name: "",
	description: "",
	contribution_amount: "",
	target_amount: "",
	asset_code: "USDC",
	contribution_frequency: "monthly",
	cycle_length_days: "",
	payout_order: "manual",
	group_type: "private",
	late_penalty: "deduct_from_balance",
	service_pct: "0",
	late_pct: "0",
	grace_days: "3",
	auto_approve_join: false,
	hide_balances: false,
};

// ---------------------------------------------------------------------------
// Small shared UI
// ---------------------------------------------------------------------------

/** Top progress bar + step title. Steps are 1-indexed. */
function StepHeader({
	step,
	total,
	title,
	onBack,
}: {
	step: number;
	total: number;
	title: string;
	onBack: () => void;
}) {
	return (
		<div>
			<button
				type="button"
				onClick={onBack}
				className="flex items-center gap-2 text-sm"
			>
				<span className="text-xl">←</span>
				<span>{step >= total ? "Review" : `Step ${step}`}</span>
			</button>
			<div className="mt-3 flex gap-2">
				{Array.from({ length: total }).map((_, i) => (
					<div
						key={i}
						className={`h-1.5 flex-1 rounded-full ${
							i < step ? "bg-primary" : "bg-neutral-light-hover"
						}`}
					/>
				))}
			</div>
			<h2 className="mt-6 text-xl md:text-2xl">{title}</h2>
		</div>
	);
}

function SelectField({
	label,
	value,
	items,
	onChange,
}: {
	label: string;
	value: string;
	items: { value: string; label: string }[];
	onChange: (v: string) => void;
}) {
	return (
		<div className="space-y-2">
			<Label className="text-sm font-light">{label}</Label>
			<Select items={items} value={value} onValueChange={onChange}>
				<SelectTrigger className="h-10.75 w-full rounded-[900px] border-neutral-light-hover bg-white px-6 md:h-12">
					<SelectValue />
				</SelectTrigger>
				<SelectContent className="bg-white text-neutral-dark">
					<SelectGroup>
						{items.map((it) => (
							<SelectItem key={it.value} value={it.value}>
								{it.label}
							</SelectItem>
						))}
					</SelectGroup>
				</SelectContent>
			</Select>
		</div>
	);
}

function ToggleRow({
	label,
	description,
	value,
	onChange,
}: {
	label: string;
	description: string;
	value: boolean;
	onChange: (v: boolean) => void;
}) {
	return (
		<div className="flex items-center justify-between gap-4">
			<div>
				<p className="text-sm font-medium">{label}</p>
				<p className="text-xs font-light text-muted-foreground">{description}</p>
			</div>
			<button
				type="button"
				onClick={() => onChange(!value)}
				className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
					value ? "bg-primary" : "bg-neutral-light-hover"
				}`}
				aria-pressed={value}
			>
				<span
					className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
						value ? "left-[22px]" : "left-0.5"
					}`}
				/>
			</button>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Wizard
// ---------------------------------------------------------------------------

export default function CreateGroupForm() {
	const router = useRouter();
	const { createGroup: createGroupOnchain } = useSavingsContract();

	const [step, setStep] = useState(1); // 1..4 (4 = success)
	const [form, setForm] = useState<FormState>(initial);
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [saving, setSaving] = useState(false);
	const [inviteUrl, setInviteUrl] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	const set =
		(key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
			setForm((f) => ({ ...f, [key]: e.target.value }));
	const setValue = (key: keyof FormState) => (v: string | boolean) =>
		setForm((f) => ({ ...f, [key]: v }));

	// --- navigation ---
	const back = () => {
		if (step === 1) router.push(pageRoutes.dashboardRoutes.GROUPS);
		else setStep((s) => s - 1);
	};

	const canProceedStep1 =
		form.name.trim() !== "" && Number(form.contribution_amount) > 0;

	// --- final create (DB + on-chain + record), then go to Success ---
	const create = async () => {
		setSaving(true);
		setErrors({});

		const payload: CreateGroupInput = {
			name: form.name,
			description: form.description || null,
			asset_code: form.asset_code || "USDC",
			contribution_amount: form.contribution_amount,
			target_amount: form.target_amount || null,
			contribution_frequency:
				form.contribution_frequency as CreateGroupInput["contribution_frequency"],
			payout_order: form.payout_order as CreateGroupInput["payout_order"],
			group_type: form.group_type as CreateGroupInput["group_type"],
			late_penalty: form.late_penalty as CreateGroupInput["late_penalty"],
			// % → basis points (100 bps = 1%); days → hours.
			fee_bps: Math.round((Number(form.service_pct) || 0) * 100),
			late_fee_bps: Math.round((Number(form.late_pct) || 0) * 100),
			grace_period_hours: (Number(form.grace_days) || 0) * 24,
			auto_approve_join: form.auto_approve_join,
			hide_balances: form.hide_balances,
			...(form.contribution_frequency === "custom"
				? { cycle_length_days: Number(form.cycle_length_days) || 1 }
				: {}),
		};

		try {
			const { group } = await groupsApi.store(payload);

			// Create on-chain (wallet signs) + record the id. Non-fatal if it fails.
			try {
				const onchainId = await createGroupOnchain({
					token: tokenFor(form.asset_code).sac,
					contributionAmount: form.contribution_amount,
					cycleLengthDays:
						form.contribution_frequency === "custom"
							? Number(form.cycle_length_days) || 1
							: 7,
					feeBps: payload.fee_bps ?? 0,
					lateFeeBps: payload.late_fee_bps ?? 0,
					gracePeriodHours: payload.grace_period_hours ?? 0,
					payoutOrder: form.payout_order,
					latePenalty: form.late_penalty,
				});
				await groupsApi.recordOnchain(group.id, {
					onchain_group_id: Number(onchainId),
				});
			} catch {
				// DB group still exists; can be activated on-chain later.
			}

			// Fetch the shareable invite link for the success screen.
			try {
				const { invite_url, invite_token } =
					await groupsApi.inviteLink(group.id);
				setInviteUrl(
					invite_url ??
						`${window.location.origin}/groups/join/${invite_token}`,
				);
			} catch {
				/* link is optional on the success screen */
			}

			setStep(4); // success
		} catch (err) {
			setErrors(fieldErrors(err));
			toast.error(
				err instanceof ApiError ? err.message : "Something went wrong.",
				"Could not create group",
			);
			setStep(1); // send them back to fix field errors
		} finally {
			setSaving(false);
		}
	};

	const copyInvite = async () => {
		if (!inviteUrl) return;
		try {
			await navigator.clipboard.writeText(inviteUrl);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			/* selectable fallback */
		}
	};

	// =========================================================================
	// STEP 4 — Success
	// =========================================================================
	if (step === 4) {
		return (
			<div className="mx-auto max-w-lg py-10 text-center">
				<div className="mx-auto flex h-28 w-28 items-center justify-center rounded-full bg-primary text-white">
					<HiCheck className="text-6xl" />
				</div>
				<h2 className="mt-6 text-2xl font-medium">
					Your Savings Group is Active
				</h2>
				<p className="mt-2 text-sm text-muted-foreground">
					Your group “{form.name}” has been successfully created. Now, invite
					your community to start growing together.
				</p>

				{inviteUrl && (
					<div className="mt-8 text-left">
						<Label className="text-sm font-light">Group Invite Link</Label>
						<div className="mt-2 flex items-center gap-2">
							<input
								readOnly
								value={inviteUrl}
								onFocus={(e) => e.currentTarget.select()}
								className="min-w-0 flex-1 truncate rounded-full border border-neutral-light-hover bg-white px-4 py-2.5 text-sm"
							/>
							<button
								type="button"
								onClick={copyInvite}
								className="flex shrink-0 items-center gap-1 rounded-full bg-primary px-4 py-2.5 text-sm text-white"
							>
								{copied ? <HiCheck /> : <HiOutlineClipboardDocument />}
							</button>
						</div>
						<p className="mt-1 text-xs text-muted-foreground">
							Anyone with this link can request to join your group.
						</p>
					</div>
				)}

				<Button
					href={pageRoutes.dashboardRoutes.OVERVIEW}
					className="mt-8 w-full"
				>
					Back to Home
				</Button>
			</div>
		);
	}

	// =========================================================================
	// STEP 3 — Review
	// =========================================================================
	if (step === 3) {
		const token = tokenFor(form.asset_code);
		return (
			<div className="mx-auto max-w-lg">
				<StepHeader step={3} total={3} title={form.name || "Review"} onBack={back} />

				<section className="mt-5 space-y-4">
					<div className="rounded-2xl bg-[#f7f7f7] p-4 md:p-6">
						<h5 className="text-xs font-light md:text-sm">Target Goal</h5>
						<h3 className="mt-1 text-2xl font-medium md:text-3xl">
							{form.target_amount
								? `${Number(form.target_amount).toLocaleString()} ${token.code}`
								: "—"}
						</h3>
					</div>

					<h3 className="md:text-lg">Overview</h3>
					<ReviewRow
						Icon={RiMoneyDollarCircleFill}
						label="Currency"
						value={token.label}
					/>
					<ReviewRow
						Icon={RiMoneyDollarCircleFill}
						label="Contribution"
						value={`${form.contribution_amount || "0"} ${token.code}`}
					/>
					<ReviewRow
						Icon={RiMoneyDollarCircleFill}
						label="Group Type"
						value={labelize(form.group_type)}
					/>
					<ReviewRow
						Icon={RiMoneyDollarCircleFill}
						label="Payout Order"
						value={labelize(form.payout_order)}
					/>
					<ReviewRow
						Icon={RiMoneyDollarCircleFill}
						label="Frequency"
						value={labelize(form.contribution_frequency)}
					/>
					<ReviewRow
						Icon={RiMoneyDollarCircleFill}
						label="Service Charge"
						value={`${form.service_pct || 0}%`}
					/>
					<ReviewRow
						Icon={PiWarningCircleFill}
						danger
						label="Late Penalty"
						value={`${form.late_pct || 0}% · after ${form.grace_days || 0} days`}
					/>
				</section>

				<Button
					onClick={create}
					isLoading={saving}
					className="mt-8 w-full"
				>
					Confirm &amp; Create
				</Button>
			</div>
		);
	}

	// =========================================================================
	// STEP 2 — Group Rules
	// =========================================================================
	if (step === 2) {
		return (
			<div className="mx-auto max-w-lg">
				<StepHeader step={2} total={3} title="Group Rules" onBack={back} />

				{/* Utility Fees — two cards */}
				<p className="mt-6 text-sm font-light">Utility Fees</p>
				<div className="mt-2 grid grid-cols-2 gap-3">
					<FeeCard
						label="Late Fee"
						suffix="%"
						value={form.late_pct}
						onChange={set("late_pct")}
						tone="pink"
					/>
					<FeeCard
						label="Service Charge"
						suffix="%"
						value={form.service_pct}
						onChange={set("service_pct")}
						tone="lilac"
					/>
				</div>

				<p className="mt-2 text-xs font-light opacity-60">
					These are the group&apos;s agreed rules. The late fee is applied
					when a payout is settled — it isn&apos;t deducted automatically
					the moment a payment is late.
				</p>

				{/* Grace period stepper */}
				<div className="mt-6">
					<p className="text-sm font-light">Grace Period (Days)</p>
					<DaysStepper
						value={Number(form.grace_days) || 0}
						onChange={(n) => setValue("grace_days")(String(n))}
					/>
				</div>

				{/* Payout order tiles */}
				<div className="mt-6">
					<p className="text-sm font-light">Payout Order</p>
					<div className="mt-3 grid grid-cols-4 gap-3">
						{PAYOUT_TILES.map(({ value, label, Icon }) => {
							const active = form.payout_order === value;
							return (
								<button
									key={value}
									type="button"
									onClick={() => setValue("payout_order")(value)}
									className="flex flex-col items-center gap-2"
								>
									<span
										className={`flex h-14 w-14 items-center justify-center rounded-full ${
											active
												? "bg-primary text-white"
												: "bg-[#f0ecff] text-primary"
										}`}
									>
										<Icon className="text-lg" />
									</span>
									<span className="text-xs">{label}</span>
								</button>
							);
						})}
					</div>
				</div>

				{/* Toggles */}
				<div className="mt-8 space-y-5">
					<ToggleRow
						label="Auto Approval"
						description="Automatically approve join requests."
						value={form.auto_approve_join}
						onChange={setValue("auto_approve_join")}
					/>
					<ToggleRow
						label="Contribute Privacy"
						description="Hide member balances from each other."
						value={form.hide_balances}
						onChange={setValue("hide_balances")}
					/>
				</div>

				{/* Late penalty policy (kept — the contract stores it) */}
				<div className="mt-6">
					<SelectField
						label="Late penalty policy"
						value={form.late_penalty}
						items={LATE_PENALTIES}
						onChange={setValue("late_penalty")}
					/>
				</div>

				{/* Info banner */}
				<div className="mt-6 flex items-center gap-3 rounded-2xl bg-primary p-4 text-white">
					<HiOutlineArrowsRightLeft className="shrink-0 text-2xl" />
					<div>
						<p className="text-sm font-medium">Trust Built on Rules</p>
						<p className="text-xs font-light">
							Clear rules reduce friction and help everyone grow together.
						</p>
					</div>
				</div>

				<div className="mt-8 flex gap-3">
					<Button variant="outline" className="flex-1" onClick={back}>
						Discard Draft
					</Button>
					<Button
						variant="dark"
						className="flex-1"
						onClick={() => setStep(3)}
					>
						Save &amp; Continue
					</Button>
				</div>
			</div>
		);
	}

	// =========================================================================
	// STEP 1 — Basics
	// =========================================================================
	return (
		<div className="mx-auto max-w-lg">
			<StepHeader step={1} total={3} title="Create Group" onBack={back} />

			<div className="mt-6 space-y-5">
				<InputField
					name="name"
					label="Group Name"
					placeholder="e.g. Agro Growth Circle"
					value={form.name}
					onChange={set("name")}
					error={errors.name}
				/>
				<InputField
					name="description"
					label="Description (optional)"
					placeholder="What is this circle for?"
					value={form.description}
					onChange={set("description")}
					error={errors.description}
				/>
				<SelectField
					label="Save in (currency)"
					value={form.asset_code}
					items={TOKEN_LIST.map((t) => ({ value: t.code, label: t.label }))}
					onChange={setValue("asset_code")}
				/>
				<InputField
					name="contribution_amount"
					label={`Contribution Amount (${form.asset_code})`}
					type="number"
					placeholder="100"
					value={form.contribution_amount}
					onChange={set("contribution_amount")}
					error={errors.contribution_amount}
				/>
				<InputField
					name="target_amount"
					label="Target Amount (optional)"
					type="number"
					placeholder="5000"
					value={form.target_amount}
					onChange={set("target_amount")}
					error={errors.target_amount}
				/>
				<SelectField
					label="Contribution Frequency"
					value={form.contribution_frequency}
					items={FREQUENCIES}
					onChange={setValue("contribution_frequency")}
				/>
				{form.contribution_frequency === "custom" && (
					<InputField
						name="cycle_length_days"
						label="Cycle Length (days)"
						type="number"
						placeholder="7"
						value={form.cycle_length_days}
						onChange={set("cycle_length_days")}
						error={errors.cycle_length_days}
					/>
				)}
				<SelectField
					label="Group Type"
					value={form.group_type}
					items={GROUP_TYPES}
					onChange={setValue("group_type")}
				/>
			</div>

			<Button
				className="mt-8 w-full"
				disabled={!canProceedStep1}
				onClick={() => setStep(2)}
			>
				Continue
			</Button>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Step-2 sub-components
// ---------------------------------------------------------------------------

function FeeCard({
	label,
	suffix,
	value,
	onChange,
	tone,
}: {
	label: string;
	suffix: string;
	value: string;
	onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
	tone: "pink" | "lilac";
}) {
	const bg = tone === "pink" ? "bg-[#ffe6f3]" : "bg-[#efeaff]";
	return (
		<div className={`rounded-2xl ${bg} p-4`}>
			<p className="text-xs font-light">{label}</p>
			<div className="mt-2 flex items-baseline gap-1">
				<input
					type="number"
					value={value}
					onChange={onChange}
					className="w-full min-w-0 bg-transparent text-2xl font-semibold outline-none"
				/>
				<span className="text-lg font-medium">{suffix}</span>
			</div>
		</div>
	);
}

function DaysStepper({
	value,
	onChange,
}: {
	value: number;
	onChange: (n: number) => void;
}) {
	return (
		<div className="mt-2 flex items-center justify-between rounded-full border border-neutral-light-hover px-4 py-2.5">
			<button
				type="button"
				onClick={() => onChange(Math.max(0, value - 1))}
				className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f0ecff] text-primary"
			>
				<HiMinus />
			</button>
			<span className="text-sm font-medium">{value} days</span>
			<button
				type="button"
				onClick={() => onChange(value + 1)}
				className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-white"
			>
				<HiPlus />
			</button>
		</div>
	);
}

function ReviewRow({
	Icon,
	label,
	value,
	danger,
}: {
	Icon: React.ComponentType<{ className?: string }>;
	label: string;
	value: string;
	danger?: boolean;
}) {
	return (
		<div className="flex items-center justify-between border-b border-b-[#eee] pb-2">
			<div className="flex items-center gap-2">
				<Icon
					className={`text-lg ${danger ? "text-[#FF0000]" : "text-primary"}`}
				/>
				<span className="text-sm font-light">{label}</span>
			</div>
			<span
				className={`text-sm font-medium ${danger ? "text-[#FF0000]" : ""}`}
			>
				{value}
			</span>
		</div>
	);
}
