/**
 * Prisma client singletons.
 *
 * Next.js dev mode hot-reloads modules on every edit. Without caching the
 * clients on `globalThis`, each reload opens a fresh connection pool and the
 * database runs out of connections within a few minutes of editing.
 */

import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
	prisma: PrismaClient | undefined;
	prismaDirect: PrismaClient | undefined;
};

/**
 * The transaction-scoped client passed to `prisma.$transaction(async (tx) => …)`.
 *
 * Exported because the callback parameter is otherwise inferred as `any` under
 * `noImplicitAny`, which would silently drop type checking inside every
 * transaction — exactly where the money-handling code lives.
 */
export type PrismaTransaction = Omit<
	PrismaClient,
	"$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/**
 * Prisma 7 takes the connection through a driver adapter rather than a `url`
 * in the schema.
 *
 * There are TWO connection strings and TWO clients, because a single one
 * cannot satisfy both constraints below at once:
 *
 * - `prisma.$transaction(async (tx) => …)` opens an interactive,
 *   multi-statement transaction, and a transaction-mode pgbouncer pooler
 *   recycles the underlying connection between statements — it cannot hold
 *   one open across a round trip. Every interactive transaction on that
 *   pooler fails with "Unable to start a transaction in the given time"
 *   (P2028). This bit us in dev: `/auth/register/verify-otp` 500s the moment
 *   it calls `$transaction`, confirmed against a real Supabase pooler
 *   connection, not simulated. So `$transaction` needs `DIRECT_URL`
 *   (session-mode, e.g. Supabase's `:5432`).
 * - Session mode has a hard, project-wide cap on total concurrent clients
 *   (observed in production: `(EMAXCONNSESSION) max clients reached in
 *   session mode - max clients are limited to pool_size: 15`) — shared across
 *   every serverless instance that connects. Routing plain, non-transactional
 *   reads through it too (as an earlier version of this file did, "simplest
 *   correct fix is: use the DIRECT connection everywhere") burns that scarce
 *   budget on queries that never needed session semantics, and a page that
 *   fans out several reads at once (e.g. dashboard + profile + notifications
 *   on load) can exhaust it under perfectly ordinary concurrent traffic.
 *
 * So: `prisma` (pooled, `DATABASE_URL`, transaction-mode pgbouncer) is what
 * every plain query should use — it's what `import { prisma } from
 * "@/server/db"` gives you, and that pooler's connection budget is much
 * larger since it's shared/multiplexed rather than one-session-per-client.
 * `withTransaction` below is the ONLY thing that touches the direct,
 * session-mode client — reserving that scarce 15-connection budget for the
 * handful of routes that have a real correctness reason to need it (atomic
 * OTP consumption, exactly-one-primary-destination swaps, position
 * renumbering). Do not call `.$transaction` on `prisma` directly, and do not
 * import or export the direct client for general use.
 */
function createClient(connectionString: string, poolMax: number): PrismaClient {
	return new PrismaClient({
		// The first argument is a full `pg.PoolConfig`, not just a URL.
		//
		// `keepAlive` is the one that matters against Supabase's Supavisor
		// pooler: without TCP keepalives an idle connection can be dropped by
		// the pooler (or anything NATting the path) without a FIN reaching us,
		// so `pg` hands the next query a socket that is already dead and the
		// request fails with a bare "Connection terminated unexpectedly" —
		// which is not a Prisma error code and so matches no retry branch below.
		adapter: new PrismaPg({
			connectionString,
			keepAlive: true,
			// Probe before the common 60s NAT/idle cutoffs rather than after.
			keepAliveInitialDelayMillis: 30_000,
			// Default is 10s. The session pooler has been observed taking ~3s
			// just to hand over a connection from this network, so 10s leaves
			// very little headroom on a cold pool.
			connectionTimeoutMillis: 20_000,
			max: poolMax,
		}),
		log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
		transactionOptions: {
			// Prisma's default is 5s. Verified against a live Supabase free-tier
			// session pooler: an interactive $transaction occasionally waits
			// longer than 5s for a connection handoff and fails with P2028
			// ("Unable to start a transaction in the given time") even though
			// the query itself is fine — a retry immediately succeeds. 15s
			// absorbs that without masking a genuinely stuck transaction.
			maxWait: 15_000,
			timeout: 15_000,
		},
	});
}

function requireEnv(name: "DATABASE_URL" | "DIRECT_URL"): string {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is not set.`);
	return value;
}

export const prisma =
	globalForPrisma.prisma ??
	// node-postgres defaults `max` to 10; the transaction-mode pooler
	// multiplexes many logical clients over a shared backend pool, so this
	// isn't fighting the same 15-session cap the direct client below is.
	createClient(requireEnv("DATABASE_URL"), 10);

// THE IMPORTANT ONE for the session-mode budget. Supavisor's SESSION mode
// allows this project 15 clients IN TOTAL across every process that
// connects, and this client is now used only by `withTransaction` — 3 lets
// roughly five instances coexist within that budget even if every one of
// them happens to be mid-transaction at once.
const prismaDirect =
	globalForPrisma.prismaDirect ?? createClient(requireEnv("DIRECT_URL"), 3);

if (process.env.NODE_ENV !== "production") {
	globalForPrisma.prisma = prisma;
	globalForPrisma.prismaDirect = prismaDirect;
}

/**
 * Run an interactive transaction, retrying once or twice on P2028.
 *
 * Even on the DIRECT (session-mode) connection and even with `maxWait`/
 * `timeout` raised to 15s, Supabase's free-tier pooler has been observed to
 * fail an interactive transaction's opening `BEGIN` outright with P2028
 * ("Unable to start a transaction in the given time") — confirmed live in dev
 * on `/auth/register/complete-profile`, which then succeeded on the very next
 * attempt with no code change. That shape — fails, retried the same call
 * succeeds — is exactly what a short retry buys you and what a longer
 * timeout does not, since the first attempt wasn't slow, it was refused.
 *
 * Every call site using this MUST be safe to run twice: either the work
 * inside is naturally idempotent, or a retry after a genuine partial failure
 * would just redo work that already failed to commit (transactions roll back
 * atomically, so there is no partial-commit case to worry about here).
 */
export async function withTransaction<T>(
	fn: (tx: PrismaTransaction) => Promise<T>,
	attempts = 3,
): Promise<T> {
	for (let attempt = 1; attempt <= attempts; attempt++) {
		try {
			return await prismaDirect.$transaction(fn);
		} catch (error) {
			const isP2028 =
				error instanceof Prisma.PrismaClientKnownRequestError &&
				error.code === "P2028";

			if (!isP2028 || attempt === attempts) throw error;

			// Short, increasing backoff — this is bridging a connection-handoff
			// hiccup, not waiting out real contention.
			await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
		}
	}

	// Unreachable: the loop always returns or throws. Satisfies the compiler.
	throw new Error("withTransaction: exhausted attempts without resolution.");
}

/**
 * JSON-safe serialisation for Prisma rows.
 *
 * Two things break `JSON.stringify` on our models: `BigInt` ids (throws) and
 * `Decimal` money columns (serialise as objects). Ids become strings — beyond
 * 2^53 a number id would silently lose precision in the browser. Decimals
 * become strings too, preserving exact 7-dp values.
 */
export function serialize<T>(value: T): unknown {
	return JSON.parse(
		JSON.stringify(value, (_key, val) => {
			if (typeof val === "bigint") return val.toString();
			// Prisma Decimal instances expose toFixed(); plain objects do not.
			if (
				val !== null &&
				typeof val === "object" &&
				typeof (val as { toFixed?: unknown }).toFixed === "function" &&
				typeof (val as { toNumber?: unknown }).toNumber === "function"
			) {
				return (val as { toString(): string }).toString();
			}
			return val;
		}),
	);
}
