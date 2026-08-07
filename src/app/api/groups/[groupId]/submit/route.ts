/**
 * Broadcast a wallet-signed transaction envelope and record it.
 *
 * Ported from `GroupController::submitOnchain`.
 *
 * This is the second half of every non-custodial money action: the frontend
 * posts back the XDR its wallet signed, we submit it to Soroban and log the tx.
 * The indexer is what ultimately flips domain rows to confirmed; this endpoint
 * just gets the signed tx on-chain and returns a hash + explorer link.
 */

import { z } from "zod";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { HttpError, forbidden, handle, json, parseBody } from "@/server/http";
import { findGroupOr404 } from "@/server/groups";
import { explorerUrl, submitSignedXdr } from "@/server/stellar/service";
import { reconcileAfterResponse } from "@/server/stellar/reconcile";
import { serializeTransaction } from "@/server/serializers";

const schema = z.object({
	signed_xdr: z.string().min(1),
	type: z.enum(["create_group", "join", "contribution", "payout"]),
});

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ groupId: string }> },
) {
	return handle(async () => {
		const user = await requireUser(request);
		const { groupId } = await params;

		const group = await findGroupOr404(groupId);
		const data = await parseBody(request, schema);

		// Only someone tied to this group may broadcast a tx against it and log
		// a row under it: the organizer, or an approved member. Without this
		// check any authenticated user could attribute arbitrary transactions
		// to any group.
		if (group.organizerId !== user.id) {
			const membership = await prisma.groupMember.findUnique({
				where: { groupId_userId: { groupId: group.id, userId: user.id } },
			});

			if (!membership || membership.status !== "approved") {
				throw forbidden("You are not a member of this group.");
			}
		}

		let hash: string;
		try {
			hash = await submitSignedXdr(data.signed_xdr);
		} catch (error) {
			console.error("[groups] submit failed:", error);
			throw new HttpError(
				422,
				"The network rejected that transaction. It may have expired — please try again.",
			);
		}

		const tx = await prisma.transaction.create({
			data: {
				groupId: group.id,
				userId: user.id,
				type: data.type,
				stellarTxHash: hash,
				// sendTransaction returns PENDING; the tx is only final on-chain
				// shortly after. The indexer flips it from the chain's answer
				// rather than us claiming success on a round trip.
				status: "pending",
				explorerUrl: explorerUrl(hash),
			},
		});

		reconcileAfterResponse(group.id);

		return json(serializeTransaction(tx), 201);
	});
}
