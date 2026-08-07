/**
 * Sync the group's status from chain after the organizer started the cycle.
 *
 * Ported from `GroupController::activate`.
 *
 * SECURITY: this does NOT mark the group active on the caller's word. It
 * reconciles against the CONTRACT via the indexer, so the DB status only ever
 * changes to match the chain's real status. An organizer cannot activate a
 * circle that never started on-chain.
 */

import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { handle, json } from "@/server/http";
import { assertOrganizer, findGroupOr404 } from "@/server/groups";
import { runIndexer } from "@/server/stellar/indexer";
import { reconcileAfterResponse } from "@/server/stellar/reconcile";

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ groupId: string }> },
) {
	return handle(async () => {
		const user = await requireUser(request);
		const { groupId } = await params;

		const group = await findGroupOr404(groupId);
		assertOrganizer(group, user.id);

		if (group.onchainGroupId !== null) {
			// Inline first, so the response already carries the new status. If
			// the RPC is unreachable, retry after the response and let the cron
			// be the final net.
			try {
				// waitForPayouts=false: this route's job is reflecting the group's
				// own activation status back quickly, not settling someone else's
				// payout inline — that would add up to ~9s of on-ledger
				// confirmation polling to every activate click. The cron sweep and
				// reconcileAfterResponse below still cover it shortly after.
				await runIndexer(group.id, false);
			} catch (error) {
				console.warn("[groups] inline activate reconcile failed:", error);
				reconcileAfterResponse(group.id);
			}
		}

		const fresh = await prisma.group.findUnique({ where: { id: group.id } });

		return json({
			status: fresh?.status ?? group.status,
			current_cycle: fresh?.currentCycle ?? group.currentCycle,
		});
	});
}
