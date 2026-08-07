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

		console.info("[cron] chain-index", {
			...summary,
			ms: Date.now() - started,
		});

		return json(summary);
	});
}
