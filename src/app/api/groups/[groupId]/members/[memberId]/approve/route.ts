/**
 * Organizer approves a pending member and fixes their rotation position.
 *
 * Ported from `GroupController::approve`.
 */

import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { handle, json, notFound } from "@/server/http";
import { assertOrganizer, findGroupOr404, parseBigInt } from "@/server/groups";
import { buildJoinGroupTx } from "@/server/stellar/service";

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ groupId: string; memberId: string }> },
) {
	return handle(async () => {
		const user = await requireUser(request);
		const { groupId, memberId } = await params;

		const group = await findGroupOr404(groupId);
		assertOrganizer(group, user.id);

		const parsed = parseBigInt(memberId);
		if (parsed === null) throw notFound("Member");

		const existing = await prisma.groupMember.findUnique({
			where: { id: parsed },
			include: { user: { select: { stellarAddress: true } } },
		});

		if (!existing || existing.groupId !== group.id) throw notFound("Member");

		const member = await prisma.$transaction(async (tx) => {
			// Recompute the next position inside the transaction so two
			// simultaneous approvals cannot land on the same slot.
			const last = await tx.groupMember.aggregate({
				where: { groupId: group.id },
				_max: { payoutPosition: true },
			});

			return tx.groupMember.update({
				where: { id: existing.id },
				data: {
					status: "approved",
					payoutPosition: (last._max.payoutPosition ?? 0) + 1,
					joinedAt: new Date(),
				},
			});
		});

		// Non-custodial: admitting a member on-chain is authorized by the
		// ORGANIZER's wallet — they sign, and the member is an argument.
		//
		// Best-effort: the frontend admits on-chain directly via the contract
		// bindings, so a build failure must not 500 the approval. The DB status
		// change above has already succeeded and is the important part.
		let unsignedXdr: string | null = null;

		if (
			user.stellarAddress &&
			group.onchainGroupId !== null &&
			existing.user.stellarAddress
		) {
			try {
				unsignedXdr = await buildJoinGroupTx(
					user.stellarAddress,
					group.onchainGroupId,
					existing.user.stellarAddress,
				);
			} catch (error) {
				console.warn("[groups] could not build join_group XDR:", error);
			}
		}

		return json({ member, unsigned_xdr: unsignedXdr });
	});
}
