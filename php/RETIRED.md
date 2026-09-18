# Retired — this backend no longer runs

The Saji API is now Next.js route handlers in `src/app/api`, backed by
`src/server/*` and Prisma. **Nothing in this directory is served, scheduled, or
deployed.**

It is kept in the tree as a reference for the port — the controllers here are
the specification the route handlers were written against, and several comments
in `src/server` point back at them ("Ported from `GroupController::store`").
Delete it once the port has been in production long enough to trust.

## What this means in practice

- `php artisan serve` — not needed. `pnpm dev` serves the app and the API.
- `php artisan schedule:work` / the `* * * * *` cron entry — **not needed**, and
  no longer the thing that keeps contributions from being stuck. Reconciliation
  is `runIndexer()` in `src/server/stellar/indexer.ts`, driven inline by
  `after()` and by Vercel Cron once a day. See `RUNBOOK.md` §1.
- `backend/.env` — inert. Configuration lives in `.env.local`.
- `backend/database/database.sqlite` — stale. The live data is Postgres.

## Where each piece went

| Here | Now |
| --- | --- |
| `app/Http/Controllers/*` | `src/app/api/**/route.ts` |
| `app/Services/Stellar/StellarService.php` | `src/server/stellar/service.ts` |
| `app/Services/Stellar/ChainIndexer.php` | `src/server/stellar/indexer.ts` |
| `app/Console/Commands/IndexChainCommand.php` | `src/app/api/cron/chain-index/route.ts` |
| `app/Models/*` + `database/migrations/*` | `prisma/schema.prisma` |
| Sanctum tokens | `src/server/auth.ts` (`AccessToken` + SHA-256) |
| FormRequest validation | Zod schemas in each route |
| `$hidden` on the model | `publicUser()` in `src/server/serializers.ts` |

The rationale for each substitution is in `src/server/ARCHITECTURE.md`.

## One genuine difference to know about

The PHP `StellarService` shelled out to the `stellar` CLI with **named**
arguments. The TypeScript version builds **positional** `ScVal` arrays, where
argument order is silently load-bearing — a swap compiles and then fails on
every call. `scripts/check-call-sites.mjs` exists because of a bug of exactly
that shape; run it after touching contract calls.
