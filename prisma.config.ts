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
		url: env("DATABASE_URL"),
	},
});
