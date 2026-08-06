/**
 * Link a DB group to its on-chain group id after the organizer signs
 * `create_group`.
 *
 * Ported from `GroupController::recordOnchain`, including its security
 * reasoning — read the comments before changing any of it.
 */

import { z } from "zod";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { HttpError, handle, json, parseBody } from "@/server/http";
import { assertOrganizer, findGroupOr404 } from "@/server/groups";
import { explorerUrl, getGroup } from "@/server/stellar/service";
import type { OnchainGroup } from "@/server/stellar/service";
import { reconcileAfterResponse } from "@/server/stellar/reconcile";

const schema = z.object({
	onchain_group_id: z.number().int().min(0),
	tx_hash: z.string().max(255).nullish(),
});

/** The contract's status ordinal → our DB enum. */
function statusFromChain(status: number | undefined) {
	switch (status) {
		case 0:
			return "draft" as const;
		case 2:
			return "active" as const;
		case 3:
			return "completed" as const;
		default:
			return "open" as const;
	}
}

export async function PATCH(
	request: Request,
	{ params }: { params: Promise<{ groupId: string }> },
) {
	return handle(async () => {
		const user = await requireUser(request);
		const { groupId } = await params;

		const group = await findGroupOr404(groupId);
		assertOrganizer(group, user.id);

		const data = await parseBody(request, schema);
		const onchainId = BigInt(data.onchain_group_id);

		// One-time: don't clobber an already-recorded on-chain id.
		if (group.onchainGroupId !== null) {
			return json({
				onchain_group_id: group.onchainGroupId,
				status: group.status,
				message: "Group is already live on-chain.",
			});
		}

		// An on-chain group belongs to exactly ONE circle, and the column is
		// UNIQUE. Without this check a duplicate id reaches the database and
		// surfaces as a raw constraint violation, which tells the organizer
		// nothing. Two circles pointing at one on-chain group would also make
		// contributions to one appear in the other — a correctness guard, not
		// just a cosmetic one.
		const takenBy = await prisma.group.findFirst({
			where: { onchainGroupId: onchainId, id: { not: group.id } },
		});

		if (takenBy) {
			throw new HttpError(
				422,
				`On-chain group #${data.onchain_group_id} is already linked to “${takenBy.name}”. ` +
					"This circle needs its own on-chain group — create it again with your wallet connected.",
			);
		}

		// SECURITY: do not trust the client's claimed id. Verify the group
		// exists on-chain AND that its organizer matches this organizer's
		// wallet, so a caller cannot link an id that isn't theirs.
		//
		// But the read can be genuinely unavailable (RPC down or rate-limited).
		// Returning 503 then makes the client retry, and each retry signs a NEW
		// create_group on-chain → duplicate orphan groups. So we distinguish
		// "read unavailable" (record provisionally; the indexer verifies and
		// corrects within a minute) from "verified and WRONG" (reject).
		let state: OnchainGroup | null = null;
		try {
			state = await getGroup(onchainId);
		} catch (error) {
			// Read unavailable — fall through to a provisional record.
			console.warn("[groups] on-chain verification unavailable:", error);
		}

		if (state !== null) {
			// Read succeeded → enforce the security checks strictly.
			if (!state.organizer) {
				throw new HttpError(422, "That on-chain group does not exist.");
			}
			if (
				user.stellarAddress &&
				state.organizer !== user.stellarAddress
			) {
				throw new HttpError(
					403,
					"That on-chain group belongs to a different wallet.",
				);
			}
		}

		// Link it. When verified, seed status from chain; when only provisional,
		// leave status alone and let the indexer reconcile it from the contract.
		const updated = await prisma.group.update({
			where: { id: group.id },
			data: {
				onchainGroupId: onchainId,
				...(state !== null && { status: statusFromChain(state.status) }),
			},
		});

		if (data.tx_hash) {
			// A duplicate hash means the client retried; the tx is already
			// logged, so skip rather than fail the whole request.
			await prisma.transaction
				.create({
					data: {
						groupId: group.id,
						userId: user.id,
						type: "create_group",
						stellarTxHash: data.tx_hash,
						status: "success",
						explorerUrl: explorerUrl(data.tx_hash),
					},
				})
				.catch(() => {});
		}

		// Pull fresh on-chain state (members, status) into the DB right away,
		// after this response is already on its way to the client.
		reconcileAfterResponse(group.id);

		return json({
			onchain_group_id: updated.onchainGroupId,
			status: updated.status,
		});
	});
}
