/**
 * Group domain helpers shared across the group routes.
 *
 * Ported from the private methods on Laravel's `GroupController` and the
 * `Group` model.
 */

import type { Group } from "@prisma/client";
import { forbidden, notFound } from "./http";
import { prisma } from "./db";

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

/** Cycle length in days, derived from the chosen contribution frequency. */
export function cycleLengthFromFrequency(
	frequency: string,
	customDays?: number | null,
): number {
	switch (frequency) {
		case "daily":
			return 1;
		case "weekly":
			return 7;
		case "bi_weekly":
			return 14;
		case "monthly":
			return 30;
		case "custom":
			return customDays ?? 7;
		default:
			return 7;
	}
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

/** Assert the user can see this group, or 403. */
export async function assertVisible(
	group: Group,
	userId: bigint,
): Promise<void> {
	if (!(await isVisibleTo(group, userId))) {
		throw forbidden("You are not a member of this group.");
	}
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
