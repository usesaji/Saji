/**
 * Challenge-circle helpers.
 *
 * A public savings challenge has no pool, no rotation, and no penalties. Each
 * member saves their OWN money in their OWN wallet toward a shared target; the
 * DB records that progress against a backing on-chain tx hash so it is
 * verifiable rather than self-asserted.
 */

import type { Group } from "@prisma/client";
import { prisma } from "./db";
import { forbidden, notFound } from "./http";
import { toStroops } from "./stellar/service";

/**
 * The group must be a challenge and the user an approved member.
 *
 * A non-challenge group 404s rather than 403 — from a challenge endpoint's
 * perspective that group does not exist, and a 403 would confirm the id.
 */
export async function assertChallengeMember(
	group: Group,
	userId: bigint,
): Promise<void> {
	if (group.circleKind !== "challenge") throw notFound("Challenge");

	const membership = await prisma.groupMember.findUnique({
		where: { groupId_userId: { groupId: group.id, userId } },
	});

	if (!membership || membership.status !== "approved") {
		throw forbidden("You are not an approved member of this challenge.");
	}
}

/**
 * Confirmed savings per member, in stroops.
 *
 * Only `confirmed` deposits count. A pending row is a claim the chain has not
 * yet backed, and counting it would let a member show progress for a transfer
 * that never settled.
 */
export async function confirmedSavingsByMember(
	groupId: bigint,
): Promise<Map<bigint, bigint>> {
	const deposits = await prisma.challengeDeposit.findMany({
		where: { groupId, status: "confirmed" },
		select: { userId: true, amount: true },
	});

	const totals = new Map<bigint, bigint>();

	for (const deposit of deposits) {
		totals.set(
			deposit.userId,
			(totals.get(deposit.userId) ?? 0n) + toStroops(deposit.amount.toString()),
		);
	}

	return totals;
}

/**
 * Percentage of `target` reached by `saved`, capped at 100 and rounded to 2dp.
 *
 * Scaled integer arithmetic: converting stroops to floats first would drift on
 * large targets, and this figure is shown to users as their progress.
 */
export function percentOf(saved: bigint, target: bigint): number {
	if (target <= 0n) return 0;

	const scaled = (saved * 10_000n) / target; // basis points
	const percent = Number(scaled) / 100;

	return Math.min(100, Math.round(percent * 100) / 100);
}
