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

	// Withdrawals have NO subject row — `wallet/withdraw/log` writes the figure
	// into `meta.amount` instead. Without this they resolved to nothing, so every
	// withdrawal showed a BLANK amount in the activity feed, the transaction
	// detail view and the downloadable CSV statement.
	//
	// DISPLAY ONLY. This value is client-self-reported (`amount_source:
	// "client_reported"`) and is deliberately not verified against the chain.
	// Never let it reach a spendable balance — see the header of
	// `wallet/payout-summary` for why a client could under-report to inflate one.
	for (const tx of transactions) {
		if (amounts.has(tx.id)) continue;

		const meta = tx.meta;
		if (!meta || typeof meta !== "object" || Array.isArray(meta)) continue;

		const fields = meta as Record<string, unknown>;
		if (fields.kind === "withdrawal" && typeof fields.amount === "string") {
			amounts.set(tx.id, fields.amount);
		}
	}

	return amounts;
}

/**
 * What a transaction IS, for a human reading a statement.
 *
 * `type` alone is not enough: a circle payout (money IN) and a withdrawal
 * (money OUT) are BOTH stored as `"payout"`, which made them indistinguishable
 * on an exported statement. `meta.kind` is the only thing that separates them.
 *
 * Returns a fixed label rather than echoing `meta.kind`, so nothing a client
 * ever wrote into that field lands in an exported file verbatim.
 */
export function transactionLabel(tx: Transaction): string {
	const meta = tx.meta;
	if (meta && typeof meta === "object" && !Array.isArray(meta)) {
		if ((meta as Record<string, unknown>).kind === "withdrawal") {
			return "withdrawal";
		}
	}
	return tx.type;
}
