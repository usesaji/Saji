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
import { defineConfig, env } from "prisma/config";

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
		url: env("DIRECT_URL") ?? env("DATABASE_URL"),
	},
});
