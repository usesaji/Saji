/**
 * Link (or unlink) the user's Stellar wallet — the PUBLIC address only.
 *
 * Ported from `ProfileController::linkWallet`.
 *
 * Non-custodial: we store the G... StrKey the user's connected wallet reports,
 * never a secret key. This is what every on-chain read and action is scoped to
 * (balance, contribute, withdraw). Sending null unlinks.
 */

import { z } from "zod";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { handle, json, parseBody, validationError } from "@/server/http";

const schema = z.object({
	// `present, nullable` in Laravel — the key must be sent, but may be null.
	stellar_address: z
		.string()
		.regex(/^G[A-Z2-7]{55}$/, "That is not a valid Stellar public address.")
		.nullable(),
});

export async function PATCH(request: Request) {
	return handle(async () => {
		const user = await requireUser(request);
		const { stellar_address: address } = await parseBody(request, schema);

		if (address) {
			// One wallet per account: reject an address already linked elsewhere
			// with a clean 422 instead of a DB-level 500.
			const taken = await prisma.user.findUnique({
				where: { stellarAddress: address },
			});

			if (taken && taken.id !== user.id) {
				throw validationError({
					stellar_address: ["That wallet is already linked to another account."],
				});
			}
		}

		const updated = await prisma.user.update({
			where: { id: user.id },
			data: { stellarAddress: address },
		});

		return json({
			stellar_address: updated.stellarAddress,
			linked: Boolean(updated.stellarAddress),
		});
	});
}
