/**
 * Drag-and-drop "who gets paid first".
 *
 * Ported from `GroupController::setPayoutOrder`.
 *
 * The organizer submits the desired order of member ids; we set each member's
 * payout_position off-chain and, for a Manual-order group already live
 * on-chain, return the unsigned set_payout_order tx that freezes that order.
 *
 * The submitted list must be EXACTLY the group's approved members — same set,
 * no omissions, no extras, no duplicates — so a reorder can never add or drop
 * anyone from the rotation. That check is the whole security of this endpoint:
 * without it, a crafted list could silently write someone out of a payout.
 */

import { z } from "zod";
import { prisma, type PrismaTransaction } from "@/server/db";
import { requireUser } from "@/server/auth";
import { HttpError, handle, json, parseBody } from "@/server/http";
import { assertOrganizer, findGroupOr404 } from "@/server/groups";
import { buildSetPayoutOrderTx } from "@/server/stellar/service";

const schema = z.object({
	// Accepts numbers or numeric strings: ids are serialised as strings
	// (BigInt), so the client naturally sends them back that way.
	member_ids: z
		.array(z.union([z.number().int(), z.string().regex(/^\d+$/)]))
		.min(2),
});

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ groupId: string }> },
) {
	return handle(async () => {
		const user = await requireUser(request);
		const { groupId } = await params;

		const group = await findGroupOr404(groupId);

		if (group.circleKind === "challenge") {
			throw new HttpError(422, "A savings challenge has no payout rotation.");
		}

		assertOrganizer(group, user.id);

		if (group.status !== "draft" && group.status !== "open") {
			throw new HttpError(
				422,
				"The payout order can only be changed before the cycle starts.",
			);
		}

		const data = await parseBody(request, schema);
		const submitted = data.member_ids.map((id) => BigInt(id));

		const approved = await prisma.groupMember.findMany({
			where: { groupId: group.id, status: "approved" },
			select: { userId: true },
		});

		const approvedIds = new Set(approved.map((m) => m.userId.toString()));
		const submittedIds = new Set(submitted.map((id) => id.toString()));

		// A permutation of the approved members: same length, no duplicates,
		// and no ids that aren't approved members of this group.
		const isPermutation =
			submitted.length === approved.length &&
			submittedIds.size === submitted.length &&
			[...submittedIds].every((id) => approvedIds.has(id));

		if (!isPermutation) {
			throw new HttpError(
				422,
				"The order must list each approved member exactly once.",
			);
		}

		// Persist positions 1..n in the submitted order, atomically — a partial
		// write would leave two members sharing a position.
		await prisma.$transaction(async (tx: PrismaTransaction) => {
			for (const [index, userId] of submitted.entries()) {
				await tx.groupMember.updateMany({
					where: { groupId: group.id, userId },
					data: { payoutPosition: index + 1 },
				});
			}
		});

		// Build the on-chain reorder for a Manual group that is live on-chain.
		let unsignedXdr: string | null = null;

		if (
			group.payoutOrder === "manual" &&
			user.stellarAddress &&
			group.onchainGroupId !== null
		) {
			const members = await prisma.groupMember.findMany({
				where: { groupId: group.id, userId: { in: submitted } },
				include: { user: { select: { stellarAddress: true } } },
				orderBy: { payoutPosition: "asc" },
			});

			const addresses = members
				.map((m) => m.user.stellarAddress)
				.filter((a): a is string => Boolean(a));

			// Only build if EVERY member has a linked wallet — a partial
			// permutation would be rejected on-chain.
			if (addresses.length === submitted.length) {
				try {
					unsignedXdr = await buildSetPayoutOrderTx(
						user.stellarAddress,
						group.onchainGroupId,
						addresses,
					);
				} catch (error) {
					// Non-fatal: the frontend signs set_payout_order directly via
					// the contract bindings. Still return the saved positions.
					console.warn("[groups] could not build set_payout_order:", error);
				}
			}
		}

		const ordered = await prisma.groupMember.findMany({
			where: { groupId: group.id },
			include: { user: { select: { id: true, name: true } } },
			orderBy: { payoutPosition: "asc" },
		});

		return json({ members: ordered, unsigned_xdr: unsignedXdr });
	});
}
