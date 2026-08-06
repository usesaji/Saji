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
 * Contract enum ordinals. These MUST match the variant order in the Soroban
 * contract — passing the wrong ordinal silently creates a group with different
 * rules than the user chose, which is far worse than an error.
 */
export const PAYOUT_ORDER_VARIANT: Record<string, number> = {
	random: 0,
	manual: 1,
	vote: 2,
	custom: 3,
};

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

/** Assert the user organizes or belongs to this group. */
export async function assertMember(
	group: Group,
	userId: bigint,
): Promise<void> {
	if (group.organizerId === userId) return;

	const membership = await prisma.groupMember.findUnique({
		where: { groupId_userId: { groupId: group.id, userId } },
	});

	if (!membership || membership.status === "removed") {
		throw forbidden("You are not a member of this circle.");
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
