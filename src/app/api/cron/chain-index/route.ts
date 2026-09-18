/**
 * Scheduled chain reconciliation — the replacement for Laravel's
 * `Schedule::command('chain:index')->everyThirtySeconds()`.
 *
 * CADENCE CHANGE, deliberate: Vercel Hobby allows at most one cron run per
 * day, so this sweep runs at 00:00 UTC. The user-facing path is unaffected
 * because routes that mutate on-chain state still call `runIndexer(groupId)`
 * inline for that group. This sweep is the safety net, not the main path.
 *
 * Idempotent, so an overlapping or retried run is harmless.
 */

import { runIndexer } from "@/server/stellar/indexer";
import { sweepExpired } from "@/server/oauth";
import { safeEqual } from "@/server/auth";
import { handle, json } from "@/server/http";

/**
 * This route reconciles live on-chain state and must never be served from
 * cache — a cached 200 would make the indexer appear to run while doing
 * nothing.
 */
export const dynamic = "force-dynamic";

/**
 * Soroban reads for many groups can exceed the default 10s budget. 60s is the
 * Hobby-plan ceiling; raise it on Pro if group count grows.
 */
export const maxDuration = 60;

/**
 * Reject anything that isn't Vercel Cron or a holder of the shared secret.
 *
 * Vercel sets `Authorization: Bearer $CRON_SECRET` on scheduled invocations.
 * Without this check the endpoint is a public, unauthenticated way to make the
 * server hammer the RPC.
 */
function assertAuthorized(request: Request): void {
	const secret = process.env.CRON_SECRET ?? "";

	// Fail CLOSED. A missing secret in production must not mean "allow all".
	if (!secret) {
		if (process.env.NODE_ENV === "production") {
			throw new Error("CRON_SECRET is not set; refusing to run the indexer.");
		}
		return;
	}

	const header = request.headers.get("authorization") ?? "";
	const provided = header.startsWith("Bearer ") ? header.slice(7) : "";

	if (!provided || !safeEqual(provided, secret)) {
		throw new Response("Unauthorized", { status: 401 });
	}
}

export async function GET(request: Request) {
	return handle(async () => {
		try {
			assertAuthorized(request);
		} catch (thrown) {
			if (thrown instanceof Response) return thrown;
			throw thrown;
		}

		const started = Date.now();
		const summary = await runIndexer();

		// Housekeeping for the two tables that accumulate short-lived rows.
		// Neither had a cleaner: `oauth_handoffs` rows that are never redeemed
		// (user closes the tab, network drops) stayed forever, and the shared
		// rate-limit buckets would grow one row per key indefinitely. Both are
		// best-effort — a failed sweep must not fail the reconcile sweep.
		const swept = await sweepExpired().catch((error) => {
			console.warn("[cron] expired-row sweep failed:", error);
			return { expired_handoffs_swept: 0, expired_rate_limits_swept: 0 };
		});

		const ms = Date.now() - started;

		// Escalate above info level when reads are failing. In steady state
		// `read_failures` is 0; a nonzero value means contract reads are being
		// swallowed somewhere, and because this indexer skips rather than throws,
		// that is otherwise indistinguishable from having no work to do. This log
		// line is the intended hook for an alert.
		if (summary.read_failures > 0) {
			console.error("[cron] chain-index DEGRADED — contract reads failing", {
				...summary,
				...swept,
				ms,
			});
		} else {
			console.info("[cron] chain-index", { ...summary, ...swept, ms });
		}

		return json({ ...summary, ...swept });
	});
}
