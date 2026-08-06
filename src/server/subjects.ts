/**
 * Resolving a Transaction's polymorphic `subject`.
 *
 * Laravel's `nullableMorphs()` gave us `$tx->subject` via eager loading. Prisma
 * has no polymorphic relations, so the lookup is explicit — batched by type so
 * a feed page costs two queries rather than one per row.
 *
 * `subjectType` holds the Laravel class name (e.g. `App\Models\Contribution`)
 * for rows written by the old backend, so both that and a bare model name are
 * accepted. Dropping the legacy form would silently blank the amount on every
 * pre-migration row.
 */

import { prisma } from "./db";
import type { Transaction } from "@prisma/client";

function normalizeType(subjectType: string | null): string | null {
	if (!subjectType) return null;
	// "App\Models\Contribution" -> "contribution"
	const bare = subjectType.split("\\").pop() ?? subjectType;
	return bare.toLowerCase();
}

/**
 * Amounts for a batch of transactions, keyed by transaction id.
 *
 * Contribution carries `amount`; Payout exposes the member's NET receipt, which
 * is what they actually got after fees — showing gross would overstate it.
 */
export async function resolveSubjectAmounts(
	transactions: Transaction[],
): Promise<Map<bigint, string>> {
	const contributionIds: bigint[] = [];
	const payoutIds: bigint[] = [];

	for (const tx of transactions) {
		if (tx.subjectId === null) continue;

		const type = normalizeType(tx.subjectType);
		if (type === "contribution") contributionIds.push(tx.subjectId);
		else if (type === "payout") payoutIds.push(tx.subjectId);
	}

	const [contributions, payouts] = await Promise.all([
		contributionIds.length
			? prisma.contribution.findMany({
					where: { id: { in: contributionIds } },
					select: { id: true, amount: true },
				})
			: Promise.resolve([]),
		payoutIds.length
			? prisma.payout.findMany({
					where: { id: { in: payoutIds } },
					select: { id: true, netAmount: true },
				})
			: Promise.resolve([]),
	]);

	const byContribution = new Map(
		contributions.map((row) => [row.id, row.amount.toString()]),
	);
	const byPayout = new Map(
		payouts.map((row) => [row.id, row.netAmount.toString()]),
	);

	const amounts = new Map<bigint, string>();

	for (const tx of transactions) {
		if (tx.subjectId === null) continue;

		const type = normalizeType(tx.subjectType);
		const amount =
			type === "contribution"
				? byContribution.get(tx.subjectId)
				: type === "payout"
					? byPayout.get(tx.subjectId)
					: undefined;

		if (amount !== undefined) amounts.set(tx.id, amount);
	}

	return amounts;
}
