/**
 * Ask the backend to reconcile this group with the chain now — e.g. right after
 * the member settled a contribution on-chain from the frontend.
 *
 * Ported from `ContributionController::confirm`.
 *
 * SECURITY: this endpoint does NOT trust the caller's word that they paid. It
 * runs the indexer, which reads the CONTRACT (`has_contributed`) and confirms
 * only contributions the chain actually shows as paid. A member cannot mark
 * themselves paid without a real on-chain transfer — the chain is the sole
 * authority for `confirmed` state.
 *
 * It is only a "reconcile faster than the scheduled run" trigger; the periodic
 * indexer would reach the same state within a minute regardless.
 */

import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { handle, json } from "@/server/http";
import { assertApprovedMember, findGroupOr404 } from "@/server/groups";
import { runIndexer } from "@/server/stellar/indexer";
import { reconcileAfterResponse } from "@/server/stellar/reconcile";
import { serializeContribution } from "@/server/serializers";

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ groupId: string }> },
) {
	return handle(async () => {
		const user = await requireUser(request);
		const { groupId } = await params;

		const group = await findGroupOr404(groupId);

		// Must be an approved member to even ask.
		await assertApprovedMember(group, user.id);

		if (group.onchainGroupId !== null) {
			// Try inline first so the response already reflects the new state.
			// If the RPC is unreachable, fall back to `after()` — the response
			// goes out immediately either way, and the cron is the final net.
			try {
				// waitForPayouts=false: this call's job is confirming the caller's
				// OWN contribution quickly, not settling a payout inline — that
				// would add up to ~9s of on-ledger confirmation polling to every
				// contribute click.
				await runIndexer(group.id, false);
			} catch (error) {
				console.warn("[contributions] inline reconcile failed:", error);
			}

			// ALWAYS, not only when the inline pass threw. This is the call that
			// actually settles the cycle: `runIndexer(id, false)` skips
			// `triggerPayoutIfReady` outright, so the pass above can confirm the
			// LAST outstanding contribution and still leave the pot unpaid.
			//
			// Scheduling this only in the `catch` meant a fully-funded cycle was
			// never paid out on the happy path — nothing called `trigger_payout`
			// until the daily 00:00 UTC sweep, so the recipient saw an empty Saji
			// Balance for up to 24 hours after the money was all in. Worse, the
			// payout arrived SOONER when the inline reconcile failed, because only
			// the failure path scheduled the pass that pays.
			//
			// Safe to run after a successful inline pass: the indexer is
			// idempotent, and this one runs after the response is flushed.
			reconcileAfterResponse(group.id);
		}

		// Return the member's current-cycle contribution AS THE CHAIN LEFT IT.
		// Re-read the group: the indexer may have advanced the cycle.
		const fresh = await prisma.group.findUnique({ where: { id: group.id } });

		const contribution = await prisma.contribution.findUnique({
			where: {
				groupId_userId_cycle: {
					groupId: group.id,
					userId: user.id,
					cycle: fresh?.currentCycle ?? group.currentCycle,
				},
			},
		});

		return json(contribution ? serializeContribution(contribution) : null);
	});
}
