/**
 * Group domain helpers shared across the group routes.
 *
 * Ported from the private methods on Laravel's `GroupController` and the
 * `Group` model.
 */

import type { Group } from "@prisma/client";
import { forbidden, notFound } from "./http";
import { prisma } from "./db";
import { fromStroops, toStroops } from "./stellar/service";

/**
 * Contract enum ordinals.
 *
 * These MUST match the variant order in the Soroban contract — passing the
 * wrong ordinal silently creates a group with different rules than the user
 * chose, which is far worse than an error. The authority is the generated
 * bindings in `src/lib/contract/savings/src/index.ts`; do not reorder these
 * without re-reading that file.
 *
 * PayoutOrder: Manual=0, Random=1, Vote=2, Custom=3.
 */
export const PAYOUT_ORDER_VARIANT: Record<string, number> = {
	manual: 0,
	random: 1,
	vote: 2,
	custom: 3,
};

/** LatePenalty: DeductFromBalance=0, RemoveMember=1. */
export const LATE_PENALTY_VARIANT: Record<string, number> = {
	deduct_from_balance: 0,
	remove_member: 1,
};

/**
 * Compare a DB group's terms against the on-chain config it is about to be
 * linked to, returning a human-readable description of each disagreement.
 *
 * WHY THIS EXISTS. A circle's terms are written twice by two independent calls:
 * `POST /api/groups` creates the DB row that the UI and the public join preview
 * display, and `create_group` writes the config the contract actually enforces.
 * Nothing connected them. An organizer could therefore create a DB row
 * advertising a monthly cycle with a 2% late fee, invoke `create_group`
 * directly with `cycle_length = 1` second, `grace_period = 0` and
 * `late_fee_bps = 10000`, link the two, and collect every member's entire
 * payout in late fees — while every screen a member sees shows the friendly
 * terms. Members must not be able to agree to terms they cannot see.
 *
 * Returns [] when everything agrees.
 */
export function describeConfigMismatch(
	group: Pick<
		Group,
		| "contributionAmount"
		| "cycleLengthSeconds"
		| "feeBps"
		| "lateFeeBps"
		| "gracePeriodHours"
		| "payoutOrder"
		| "latePenalty"
	>,
	state: {
		amount: bigint;
		cycle_length: bigint;
		fee_bps: number;
		late_fee_bps: number;
		grace_period: bigint;
		payout_order: number;
		late_penalty: number;
	},
): string[] {
	const problems: string[] = [];

	const expectedAmount = toStroops(group.contributionAmount.toString());
	if (BigInt(state.amount) !== expectedAmount) {
		problems.push(
			`contribution is ${fromStroops(BigInt(state.amount))} on-chain but ${group.contributionAmount} here`,
		);
	}

	// Both sides are seconds now — no conversion, so no unit bug to hide in.
	if (BigInt(state.cycle_length) !== BigInt(group.cycleLengthSeconds)) {
		problems.push(
			`cycle is ${BigInt(state.cycle_length)}s on-chain but ${group.cycleLengthSeconds}s here`,
		);
	}

	const expectedGrace = BigInt(group.gracePeriodHours) * 3_600n;
	if (BigInt(state.grace_period) !== expectedGrace) {
		problems.push(
			`grace period is ${BigInt(state.grace_period)}s on-chain but ${group.gracePeriodHours}h here`,
		);
	}

	if (state.fee_bps !== group.feeBps) {
		problems.push(
			`service fee is ${state.fee_bps}bps on-chain but ${group.feeBps}bps here`,
		);
	}

	if (state.late_fee_bps !== group.lateFeeBps) {
		problems.push(
			`late fee is ${state.late_fee_bps}bps on-chain but ${group.lateFeeBps}bps here`,
		);
	}

	const expectedOrder = PAYOUT_ORDER_VARIANT[group.payoutOrder];
	if (expectedOrder !== undefined && state.payout_order !== expectedOrder) {
		problems.push("payout order policy differs");
	}

	const expectedPenalty = LATE_PENALTY_VARIANT[group.latePenalty];
	if (expectedPenalty !== undefined && state.late_penalty !== expectedPenalty) {
		problems.push("late-penalty policy differs");
	}

	return problems;
}

/**
 * Cycle length in SECONDS for each preset frequency.
 *
 * Seconds, not days, because that is the unit the contract uses — keeping both
 * sides in the same unit removes the ×86400 conversion that used to sit on
 * every path in and out of the database, and makes sub-daily cycles
 * expressible at all.
 */
export const FREQUENCY_SECONDS: Record<string, number> = {
	hourly: 3_600,
	six_hourly: 21_600,
	daily: 86_400,
	two_daily: 172_800,
	weekly: 604_800,
	bi_weekly: 1_209_600,
	monthly: 2_592_000, // 30 days
	quarterly: 7_776_000, // 90 days
	yearly: 31_536_000, // 365 days
};

/** Contract bounds — `create_group` rejects anything outside these. */
export const MIN_CYCLE_SECONDS = 3_600; // 1 hour
export const MAX_CYCLE_SECONDS = 31_536_000; // 1 year

/** Cycle length in seconds, derived from the chosen contribution frequency. */
export function cycleLengthFromFrequency(
	frequency: string,
	customSeconds?: number | null,
): number {
	if (frequency === "custom") return customSeconds ?? FREQUENCY_SECONDS.weekly;
	return FREQUENCY_SECONDS[frequency] ?? FREQUENCY_SECONDS.weekly;
}

/**
 * The token contract address for a group's asset.
 *
 * An explicit issuer wins; otherwise map the asset code to a configured SAC,
 * falling back to USDC. Returns null when nothing is configured, and callers
 * must treat that as "cannot build a transaction" rather than substituting a
 * default — emitting a tx against the wrong token would move the wrong asset.
 */
export function tokenSac(group: Pick<Group, "assetIssuer" | "assetCode">): string | null {
	if (group.assetIssuer) return group.assetIssuer;

	const sacs: Record<string, string | undefined> = {
		USDC: process.env.STELLAR_USDC_SAC,
		USDT: process.env.STELLAR_USDT_SAC,
		XLM: process.env.STELLAR_XLM_SAC,
	};

	return sacs[group.assetCode] ?? process.env.STELLAR_USDC_SAC ?? null;
}

/**
 * Load a group by id, or 404.
 *
 * Laravel's route-model binding did this implicitly; here it must be explicit,
 * because a missing check would let `null` flow into an authorization test and
 * pass it.
 */
export async function findGroupOr404(id: string): Promise<Group> {
	const groupId = parseBigInt(id);
	if (groupId === null) throw notFound("Group");

	const group = await prisma.group.findUnique({ where: { id: groupId } });
	if (!group) throw notFound("Group");

	return group;
}

/** Assert the user organizes this group. */
export function assertOrganizer(group: Group, userId: bigint): void {
	if (group.organizerId !== userId) {
		throw forbidden("Only the organizer can do that.");
	}
}

/**
 * Can this user see the group's private detail — finances, member roster
 * (names + Stellar addresses), and the invite token?
 *
 * Ported from `Group::isVisibleTo`. Challenges and public circles are open to
 * everyone. Otherwise: the organizer, plus anyone with a live membership.
 *
 * PENDING requesters are deliberately included — they need to see what they
 * asked to join. Declined and removed members are not.
 */
export async function isVisibleTo(
	group: Group,
	userId: bigint,
): Promise<boolean> {
	if (group.circleKind === "challenge" || group.groupType === "public") {
		return true;
	}

	if (group.organizerId === userId) return true;

	const membership = await prisma.groupMember.findUnique({
		where: { groupId_userId: { groupId: group.id, userId } },
	});

	return (
		membership !== null &&
		(membership.status === "approved" || membership.status === "pending")
	);
}

/**
 * Assert the user can see this group, or 404.
 *
 * NOT 403. `findGroupOr404` already answers 404 for a group that does not
 * exist, so a 403 here made the pair an enumeration oracle: walking ids told
 * you exactly which circles are real. `ARCHITECTURE.md` states the policy is to
 * answer 404 on an ownership failure for precisely this reason, and this was
 * the one place that didn't. "Not yours" and "not there" must be
 * indistinguishable from outside.
 */
export async function assertVisible(
	group: Group,
	userId: bigint,
): Promise<void> {
	if (!(await isVisibleTo(group, userId))) {
		throw notFound("Group");
	}
}

/**
 * The viewer's relationship to a group, for decisions that are not a simple
 * yes/no — privacy masking and how much detail a not-yet-approved requester
 * should get.
 */
export type Viewership =
	| "organizer"
	| "member"
	/** Holds an unapproved join request against THIS group. */
	| "pending"
	/** Not a member, but the group is public or a challenge, so it is readable. */
	| "viewer"
	| "none";

export async function viewershipOf(
	group: Group,
	userId: bigint,
): Promise<Viewership> {
	if (group.organizerId === userId) return "organizer";

	const membership = await prisma.groupMember.findUnique({
		where: { groupId_userId: { groupId: group.id, userId } },
	});

	if (membership?.status === "approved") return "member";

	// `pending` is deliberately NOT the same as `viewer`. A pending requester
	// used an invite link on a circle that is otherwise closed, and holding them
	// at the door is the whole point. Someone browsing an open circle is making
	// no request at all and must keep the access "public" already promises —
	// conflating the two would quietly have closed every public circle.
	if (membership?.status === "pending") return "pending";

	if (group.circleKind === "challenge" || group.groupType === "public") {
		return "viewer";
	}

	return "none";
}

/**
 * Assert the user is an APPROVED member — the bar for acting on a group
 * (contributing, depositing), which is stricter than merely seeing it.
 */
export async function assertApprovedMember(
	group: Group,
	userId: bigint,
): Promise<void> {
	const membership = await prisma.groupMember.findUnique({
		where: { groupId_userId: { groupId: group.id, userId } },
	});

	if (!membership || membership.status !== "approved") {
		throw forbidden("You are not an approved member of this group.");
	}
}

/** Parse a path segment into a BigInt id, or null if it isn't one. */
export function parseBigInt(value: string): bigint | null {
	if (!/^\d+$/.test(value)) return null;
	try {
		return BigInt(value);
	} catch {
		return null;
	}
}
