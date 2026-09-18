/**
 * Prisma CLI configuration.
 *
 * Prisma 7 removed `url` from the `datasource` block in schema.prisma. The
 * connection string now lives here for CLI commands (`migrate`, `db push`,
 * `studio`), while the runtime client gets it through a driver adapter in
 * `src/server/db.ts`.
 */

// Next.js loads `.env.local` automatically at runtime, but the Prisma CLI is a
// separate process that does not, so load it explicitly here. `.env` is read
// too, for parity with deployments that use it.
import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

export default defineConfig({
	schema: "prisma/schema.prisma",
	migrations: {
		path: "prisma/migrations",
	},
	datasource: {
		// Migrations run against the SESSION-mode pooler (port 5432). The
		// transaction-mode pooler on 6543 multiplexes connections and cannot
		// hold the session state that CREATE TABLE / ALTER TYPE require, so
		// schema changes issued through it fail or silently misbehave.
		//
		// Falls back to DATABASE_URL for setups with a single direct connection.
		// Use process.env (not env()) so prisma generate succeeds when DIRECT_URL
		// is unset — env() throws before the ?? fallback can run.
		//
		// This is also what `pnpm vercel-build` uses for `migrate deploy`, so
		// DIRECT_URL must be set in the Vercel project's environment variables —
		// not only DATABASE_URL. Without it migrations run through the 6543
		// transaction pooler and DDL fails, per the note above.
		url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
	},
});
