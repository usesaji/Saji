/**
 * Prisma client singleton.
 *
 * Next.js dev mode hot-reloads modules on every edit. Without caching the
 * client on `globalThis`, each reload opens a fresh connection pool and the
 * database runs out of connections within a few minutes of editing.
 */

import { PrismaClient } from "@prisma/client";
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
 * in the schema. `connectionString` must point at a POOLED endpoint in
 * production — each serverless instance opens its own pool, so a direct
 * Postgres connection runs out of slots under load.
 */
function createClient(): PrismaClient {
	const connectionString = process.env.DATABASE_URL;

	if (!connectionString) {
		throw new Error("DATABASE_URL is not set.");
	}

	return new PrismaClient({
		adapter: new PrismaPg({ connectionString }),
		log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
	});
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
	globalForPrisma.prisma = prisma;
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
