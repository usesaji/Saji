/** Shared lookup for withdrawal destinations. */

import type { WithdrawInfo } from "@prisma/client";
import { prisma } from "./db";
import { notFound } from "./http";
import { parseBigInt } from "./groups";

/**
 * Load a destination that belongs to `userId`, or 404.
 *
 * A destination owned by someone else returns 404, NOT 403 — matching the
 * Laravel `abort_unless(..., 404)`. A 403 would confirm the id exists, letting
 * a caller enumerate other users' destination ids.
 */
export async function findDestinationOr404(
	id: string,
	userId: bigint,
): Promise<WithdrawInfo> {
	const parsed = parseBigInt(id);
	if (parsed === null) throw notFound("Destination");

	const destination = await prisma.withdrawInfo.findUnique({
		where: { id: parsed },
	});

	if (!destination || destination.userId !== userId) {
		throw notFound("Destination");
	}

	return destination;
}
