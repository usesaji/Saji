/**
 * Fire a targeted reconcile right after an on-chain action, so the DB reflects
 * the new state in ~1s instead of waiting for the scheduled sweep.
 *
 * This replaces Laravel's `SpawnsChainReconcile`, which used
 * `exec("php artisan chain:index --group=N &")` to spawn a detached OS process.
 * That trick existed because PHP-FPM freezes a worker the moment it responds,
 * so there was no in-process way to keep working after the response — and it
 * was one of the two reasons the backend needed `exec()` enabled and a VPS.
 *
 * Next's `after()` does the same job as a first-class primitive: the callback
 * runs once the response has been flushed to the client, inside the same
 * function invocation. No subprocess, no PATH, no detached PID to lose track
 * of.
 *
 * Failures are swallowed on purpose. This is the fast path, not the source of
 * truth — if it fails, the cron sweep corrects the same state within a minute,
 * and a user-visible error here would be noise about work they never asked for.
 */

import { after } from "next/server";
import { runIndexer } from "./indexer";

/**
 * Schedule a reconcile of one group after the response is sent.
 *
 * Call this from any handler that mutates on-chain state. It returns
 * immediately; the work happens after the client already has its response.
 */
export function reconcileAfterResponse(groupId: bigint): void {
	after(async () => {
		try {
			await runIndexer(groupId);
		} catch (error) {
			// The scheduled sweep will catch up shortly.
			console.warn(`[reconcile] group ${groupId} failed:`, error);
		}
	});
}
