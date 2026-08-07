/**
 * A single withdrawal destination — update and delete.
 *
 * Ported from `WithdrawInfoController::update` and `::destroy`.
 */

import { prisma, withTransaction } from "@/server/db";
import { requireUser } from "@/server/auth";
import { handle, json, parseBody } from "@/server/http";
import { findDestinationOr404 } from "@/server/withdraw-info";
import { destinationSchema } from "../route";
import { serializeWithdrawInfo } from "@/server/serializers";

/** Update one of the user's destinations. */
export async function PATCH(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	return handle(async () => {
		const user = await requireUser(request);
		const { id } = await params;

		const existing = await findDestinationOr404(id, user.id);
		const data = await parseBody(request, destinationSchema);

		const updated = await withTransaction(async (tx) => {
			if (data.is_primary && !existing.isPrimary) {
				await tx.withdrawInfo.updateMany({
					where: { userId: user.id },
					data: { isPrimary: false },
				});
			}

			return tx.withdrawInfo.update({
				where: { id: existing.id },
				data: {
					stellarAddress: data.stellar_address,
					memo: data.memo ?? null,
					memoType: data.memo_type ?? "none",
					destinationLabel: data.destination_label ?? null,
					isPrimary: data.is_primary ?? existing.isPrimary,
				},
			});
		});

		return json(serializeWithdrawInfo(updated));
	});
}

/** Delete a destination. If it was primary, promote the newest remaining. */
export async function DELETE(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	return handle(async () => {
		const user = await requireUser(request);
		const { id } = await params;

		const existing = await findDestinationOr404(id, user.id);

		await withTransaction(async (tx) => {
			await tx.withdrawInfo.delete({ where: { id: existing.id } });

			if (existing.isPrimary) {
				const next = await tx.withdrawInfo.findFirst({
					where: { userId: user.id },
					orderBy: { createdAt: "desc" },
				});

				if (next) {
					await tx.withdrawInfo.update({
						where: { id: next.id },
						data: { isPrimary: true },
					});
				}
			}
		});

		return json({ message: "Destination removed." });
	});
}
