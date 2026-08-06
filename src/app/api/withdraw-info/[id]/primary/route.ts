/**
 * Mark a destination primary.
 *
 * Ported from `WithdrawInfoController::setPrimary`. Demote-then-promote runs in
 * one transaction so there is never a moment with two primaries or none.
 */

import { prisma, type PrismaTransaction } from "@/server/db";
import { requireUser } from "@/server/auth";
import { handle, json } from "@/server/http";
import { findDestinationOr404 } from "@/server/withdraw-info";

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	return handle(async () => {
		const user = await requireUser(request);
		const { id } = await params;

		const destination = await findDestinationOr404(id, user.id);

		const updated = await prisma.$transaction(
			async (tx: PrismaTransaction) => {
				await tx.withdrawInfo.updateMany({
					where: { userId: user.id },
					data: { isPrimary: false },
				});

				return tx.withdrawInfo.update({
					where: { id: destination.id },
					data: { isPrimary: true },
				});
			},
		);

		return json(updated);
	});
}
