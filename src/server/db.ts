/**
 * Prisma client singleton.
 *
 * Next.js dev mode hot-reloads modules on every edit. Without caching the
 * client on `globalThis`, each reload opens a fresh connection pool and the
 * database runs out of connections within a few minutes of editing.
 */

import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
	prisma: PrismaClient | undefined;
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
 * `DATABASE_URL` must point at a POOLED, TRANSACTION-mode endpoint in
 * production (e.g. Supabase's `:6543?pgbouncer=true`) — each serverless
 * instance opens its own pool, so a direct connection runs out of slots under
 * load.
 *
 * BUT: `prisma.$transaction(async (tx) => …)` opens an interactive,
 * multi-statement transaction, and a transaction-mode pooler recycles the
 * underlying connection between statements — it cannot hold one open across a
 * round trip. Every interactive transaction on that pooler fails with
 * "Unable to start a transaction in the given time" (P2028). This bit us in
 * dev: `/auth/register/verify-otp` 500s the moment it calls `$transaction`,
 * confirmed against a real Supabase pooler connection, not simulated.
 *
 * The fix is `DIRECT_URL` (session-mode, e.g. Supabase's `:5432`) for
 * anything that opens an interactive transaction, while plain queries still
 * use the pooled connection sparingly. Since every route in this codebase that
 * touches money uses `$transaction` for a real correctness reason — atomic OTP
 * consumption, exactly-one-primary-destination swaps, position renumbering —
 * simplest correct fix is: use the DIRECT connection everywhere. It does mean
 * this app needs a session-capable Postgres connection at runtime, not only at
 * migrate time; that's a real constraint to carry into the hosting choice, not
 * a temporary workaround.
 */
function createClient(): PrismaClient {
	const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

	if (!connectionString) {
		throw new Error("DATABASE_URL (or DIRECT_URL) is not set.");
	}

	return new PrismaClient({
		adapter: new PrismaPg({ connectionString }),
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

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
	globalForPrisma.prisma = prisma;
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
			return await prisma.$transaction(fn);
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
