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
import { getChallengeBalance, toStroops } from "./stellar/service";

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

/**
 * Reconcile a challenge circle's pending deposits against the challenge
 * contract's own `balance_of` — the contract's documented source of truth
 * for a member's savings, the same way rotating-circle contributions
 * reconcile against `has_contributed`.
 *
 * A member's on-chain balance is a running total, not a per-deposit ledger,
 * so this confirms pending rows OLDEST FIRST up to however much of the
 * claimed total the chain actually backs. A row past that point stays
 * pending — it's either a duplicate submission, a wrong claimed amount, or a
 * transfer that never happened, and none of those should count toward
 * progress. This also means a member can never be credited for more than
 * they've genuinely deposited, regardless of what amount they submitted.
 *
 * Returns the number of rows confirmed.
 */
export async function reconcileChallengeDeposits(groupId: bigint): Promise<number> {
	const pending = await prisma.challengeDeposit.findMany({
		where: { groupId, status: "pending" },
		include: { user: { select: { id: true, stellarAddress: true } } },
		orderBy: { createdAt: "asc" },
	});

	if (pending.length === 0) return 0;

	const byMember = new Map<bigint, typeof pending>();
	for (const deposit of pending) {
		const list = byMember.get(deposit.userId) ?? [];
		list.push(deposit);
		byMember.set(deposit.userId, list);
	}

	// Already-confirmed totals for every member with a pending row, in one
	// query rather than one `aggregate` per member — these draw on the same
	// on-chain balance, so they must be subtracted before any pending row can
	// be confirmed against what's left.
	const confirmedTotals = await prisma.challengeDeposit.groupBy({
		by: ["userId"],
		where: { groupId, userId: { in: [...byMember.keys()] }, status: "confirmed" },
		_sum: { amount: true },
	});
	const alreadyConfirmedByUser = new Map(
		confirmedTotals.map((row) => [
			row.userId,
			toStroops(row._sum.amount?.toString() ?? "0"),
		]),
	);

	// Members are independent — read every balance concurrently rather than
	// one RPC round-trip at a time.
	const members = [...byMember.entries()];
	const balances = await Promise.all(
		members.map(async ([, deposits]) => {
			const address = deposits[0].user.stellarAddress;
			if (!address) return null;
			try {
				return await getChallengeBalance(groupId, address);
			} catch {
				return null; // RPC hiccup — try again on the next sweep.
			}
		}),
	);

	let confirmed = 0;

	for (const [index, [userId, deposits]] of members.entries()) {
		const onchainBalance = balances[index];
		if (onchainBalance === null) continue;

		let remaining = onchainBalance - (alreadyConfirmedByUser.get(userId) ?? 0n);

		for (const deposit of deposits) {
			const claimed = toStroops(deposit.amount.toString());
			if (claimed > remaining) break; // Oldest-first: stop at the first gap.

			// Guarded by `status: "pending"` in the WHERE clause, not just the
			// id: this indexer sweep can overlap with itself (the cron tick and
			// a reconcileAfterResponse call from a fresh deposit can land close
			// together), and both instances compute `remaining` from the same
			// snapshot. If a concurrent sweep already confirmed this row,
			// `count` comes back 0 here — that's a no-op, not a double-confirm,
			// since the row can only be flipped once from pending.
			const result = await prisma.challengeDeposit.updateMany({
				where: { id: deposit.id, status: "pending" },
				data: { status: "confirmed", confirmedAt: new Date() },
			});

			remaining -= claimed;
			if (result.count > 0) confirmed += 1;
		}
	}

	return confirmed;
}
