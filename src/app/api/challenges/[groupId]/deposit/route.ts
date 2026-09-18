/**
 * Record a save a member made toward the challenge target.
 *
 * Ported from `ChallengeController::deposit`.
 *
 * Non-custodial: the funds moved within the member's OWN control. We store the
 * backing on-chain tx hash so progress is verifiable rather than self-asserted,
 * and the row stays 'pending' until the indexer sees that tx confirmed.
 */

import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { handle, json, parseBody, validationError } from "@/server/http";
import { findGroupOr404 } from "@/server/groups";
import { assertChallengeMember } from "@/server/challenges";
import { serializeChallengeDeposit } from "@/server/serializers";
import { reconcileAfterResponse } from "@/server/stellar/reconcile";

const schema = z.object({
	amount: z.union([
		z
			.string()
			.regex(/^\d+(\.\d{1,7})?$/, "Must be a number with at most 7 decimals"),
		z.number().positive(),
	]),
	// Required: a challenge save must correspond to real on-chain movement.
	stellar_tx_hash: z.string().min(1).max(255),
});

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ groupId: string }> },
) {
	return handle(async () => {
		const user = await requireUser(request);
		const { groupId } = await params;

		const group = await findGroupOr404(groupId);
		await assertChallengeMember(group, user.id);

		const data = await parseBody(request, schema);

		// The hash is UNIQUE in the schema, so the database is the real guard
		// against counting one transfer twice. Check first to return a clean
		// 422 rather than a constraint violation.
		const duplicate = await prisma.challengeDeposit.findUnique({
			where: { stellarTxHash: data.stellar_tx_hash },
		});

		if (duplicate) {
			throw validationError({
				stellar_tx_hash: ["That transaction has already been recorded."],
			});
		}

		// The check above is a TOCTOU: two concurrent posts of the same hash both
		// pass it, and the loser hits the unique constraint. Prisma raises P2002,
		// which nothing caught — so a duplicate submitted twice at once returned
		// a bare 500 instead of the 422 the check just above was written to give.
		let deposit;
		try {
			deposit = await prisma.challengeDeposit.create({
				data: {
					groupId: group.id,
					userId: user.id,
					amount: String(data.amount),
					stellarTxHash: data.stellar_tx_hash,
					status: "pending",
				},
			});
		} catch (error) {
			if (
				error instanceof Prisma.PrismaClientKnownRequestError &&
				error.code === "P2002"
			) {
				throw validationError({
					stellar_tx_hash: ["That transaction has already been recorded."],
				});
			}
			throw error;
		}

		// Reconcile against the challenge contract's balance_of right away so
		// the row doesn't sit pending until the next cron sweep — mirrors
		// contributions/confirm's "reconcile faster" trigger for circles.
		reconcileAfterResponse(group.id);

		return json(serializeChallengeDeposit(deposit), 201);
	});
}
