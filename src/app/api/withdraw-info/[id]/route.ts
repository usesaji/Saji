/**
 * A single withdrawal destination — update and delete.
 *
 * Ported from `WithdrawInfoController::update` and `::destroy`.
 */

import { withTransaction } from "@/server/db";
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
		// PARTIAL. Reusing the full create schema meant `stellar_address` was
		// required and every omitted optional was written as its default — so a
		// PATCH sending only `{ stellar_address }` silently ERASED the memo,
		// memo type and label. For an exchange destination that requires a memo,
		// that turns a working payout target into one that loses funds on the
		// receiving side.
		const data = await parseBody(request, destinationSchema.partial());

		const updated = await withTransaction(async (tx) => {
			if (data.is_primary && !existing.isPrimary) {
				await tx.withdrawInfo.updateMany({
					where: { userId: user.id },
					data: { isPrimary: false },
				});
			}

			return tx.withdrawInfo.update({
				where: { id: existing.id },
				// Only fields actually present in the request are written;
				// `undefined` means "not supplied", which is distinct from an
				// explicit null meaning "clear it".
				data: {
					...(data.stellar_address !== undefined && {
						stellarAddress: data.stellar_address,
					}),
					...(data.memo !== undefined && { memo: data.memo ?? null }),
					...(data.memo_type !== undefined && {
						memoType: data.memo_type ?? "none",
					}),
					...(data.destination_label !== undefined && {
						destinationLabel: data.destination_label ?? null,
					}),
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
