/**
 * Withdrawal destinations — list and create.
 *
 * Ported from `WithdrawInfoController::index` and `::store`.
 *
 * A user can save MULTIPLE payout destinations and mark one primary — the
 * default used when a withdrawal doesn't name one.
 *
 * Non-custodial: every destination is a PUBLIC Stellar address (G...) the user
 * controls, plus an optional memo some custodial destinations require. No keys
 * are ever stored.
 */

import { z } from "zod";
import { prisma, withTransaction } from "@/server/db";
import { requireUser } from "@/server/auth";
import { handle, json, parseBody } from "@/server/http";
import { serializeWithdrawInfo } from "@/server/serializers";

export const destinationSchema = z.object({
	// Stellar StrKey public address: starts with G, base32, 56 chars.
	stellar_address: z
		.string()
		.regex(/^G[A-Z2-7]{55}$/, "That is not a valid Stellar public address."),
	memo: z.string().max(64).nullish(),
	memo_type: z.enum(["text", "id", "none"]).nullish(),
	destination_label: z.string().max(100).nullish(),
	is_primary: z.boolean().nullish(),
});

/** All of the user's saved destinations, primary first. */
export async function GET(request: Request) {
	return handle(async () => {
		const user = await requireUser(request);

		const destinations = await prisma.withdrawInfo.findMany({
			where: { userId: user.id },
			orderBy: [{ isPrimary: "desc" }, { createdAt: "desc" }],
		});

		return json(destinations.map(serializeWithdrawInfo));
	});
}

/** Add a destination. The first one added becomes primary automatically. */
export async function POST(request: Request) {
	return handle(async () => {
		const user = await requireUser(request);
		const data = await parseBody(request, destinationSchema);

		const info = await withTransaction(async (tx) => {
			const isFirst =
				(await tx.withdrawInfo.count({ where: { userId: user.id } })) === 0;

			const makePrimary = Boolean(data.is_primary) || isFirst;

			// Exactly one primary per user: demote the others first.
			if (makePrimary) {
				await tx.withdrawInfo.updateMany({
					where: { userId: user.id },
					data: { isPrimary: false },
				});
			}

			return tx.withdrawInfo.create({
				data: {
					userId: user.id,
					stellarAddress: data.stellar_address,
					memo: data.memo ?? null,
					memoType: data.memo_type ?? "none",
					destinationLabel: data.destination_label ?? null,
					isPrimary: makePrimary,
				},
			});
		});

		return json(serializeWithdrawInfo(info), 201);
	});
}
