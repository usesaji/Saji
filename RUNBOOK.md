# Saji — Operations Runbook

Things to remember when running, testing, or deploying Saji. Read this before
you get confused by "why is X showing pending / empty / not working."

---

> **The Laravel backend is retired.** The API is now Next.js route handlers in
> `src/app/api`, and `backend/` is reference-only — nothing in it runs. Any
> `php artisan …` instruction you remember (or find in an older doc) no longer
> applies. See `src/server/ARCHITECTURE.md`.

## ⭐ 1. The chain indexer, and how far behind it can be

The DB is kept in sync with on-chain contract state by `runIndexer()`
(`src/server/stellar/indexer.ts`). It reconciles group **status**,
**contributions**, **payouts** and the **activity feed** from the blockchain
regardless of how an action happened. It is **idempotent** (safe to run
repeatedly, including overlapping) and **self-correcting**.

It runs on two paths, and the difference between them matters:

1. **Inline, after a response.** Every route that mutates on-chain state calls
   `reconcileAfterResponse(groupId)`, which reconciles that ONE group via
   `after()` once the response is flushed. This covers everything a user does in
   the app, usually within a second. It is best-effort — it swallows its own
   errors.
2. **The daily sweep.** `vercel.json` schedules `/api/cron/chain-index` at
   **00:00 UTC, once a day** (the Vercel Hobby plan's limit). This is the safety
   net for everything path 1 misses: a wallet that contributed outside the app,
   a tab closed mid-flow, an `after()` callback cut short.

**So: if something happened outside the app, it can be stale for up to 24
hours.** That is expected, not a bug. To fix it immediately, trigger the sweep
by hand:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/cron/chain-index          # local
```

The response is the summary — check `read_failures` in it. It should be `0`;
any sustained nonzero value means contract reads are failing and being skipped,
which is otherwise indistinguishable from "nothing to do" (the deployed logs
mark this case `chain-index DEGRADED`).

---

## 2. Running the app locally

One server:

```bash
pnpm dev            # http://localhost:3000
```

- Open the app at **http://localhost:3000**.
- `NEXT_PUBLIC_API_URL` should be **empty/unset** — the API is same-origin now.
  Set it only if you genuinely deploy the API separately.
- You need a reachable Postgres in `DATABASE_URL`/`DIRECT_URL` (see §9) and the
  Stellar vars in §5. `pnpm db:generate` after any schema change.

The old warning about `php artisan serve` failing outbound DNS is gone with the
PHP backend: server-side contract reads now happen in-process via
`@stellar/stellar-sdk` and work fine locally.

---

## 3. `.env` changes need a restart

- `NEXT_PUBLIC_*` change (e.g. `.env.local`) → **restart `pnpm dev`** (these are
  baked in at build/start; editing the file alone does nothing).
- Server-only vars are read per-invocation, but restart anyway — module-level
  constants in `src/server/stellar/service.ts` are evaluated once per process.
- `next.config.ts` change → **restart `pnpm dev`** (not hot-reloaded).

**The Stellar vars are cross-checked at startup.** `STELLAR_CONTRACT_ID` must
equal `NEXT_PUBLIC_SAVINGS_CONTRACT_ID`, and likewise for the challenge contract
and RPC URL; the server refuses to start on a mismatch rather than letting the
browser sign against one contract while the server reads another. If you see
that error, unset one of the pair — you do not need both.

---

## 4. Email (Resend)

- Sent via the Resend HTTP API from `src/server/mail.ts`, using `RESEND_API_KEY`
  and `MAIL_FROM_ADDRESS` (+ optional `MAIL_FROM_NAME`). The from-address domain
  MUST be verified in the Resend account owning the key, or every send 403s and
  OTP signup breaks.
- **Real emails only** — Resend rejects fake domains like `@example.com`.
- With either var unset, mail is **logged, not sent**: the OTP appears in the
  server console as `[otp] code for <email>: 1234`. That is the intended
  local-dev mode — but note it means a misconfigured *production* deploy prints
  codes to the log instead of failing loudly.

---

## 4b. Notifications (instant, event-driven)

Raised the moment an action **completes**, from `emit()` in
`src/server/notifications.ts`. There is no cron behind this and there must not
be: a sweep is only ever as fresh as its interval, and this project's is once a
day (see §1).

**Two legs, independent by design.** The row is always written — it is the
user's in-app history. The email is opt-out (`users.notify_by_email`) and
best-effort: `emit()` **never throws**, because it is called from paths that
have already moved money.

**Idempotency is the whole design.** Every emit carries a deterministic
`dedupe_key` (`payout:42`, `contribution:17`), unique-indexed. The indexer is
idempotent and re-observes the same completed payout on every reconcile pass —
without that key, each pass would send another email. If you add a notification,
key it on the **event**, never the attempt: no timestamps, no random component.

### One-time Supabase setup for instant delivery

1. Apply the migration: `pnpm prisma migrate deploy`. It creates the table,
   enables RLS, and adds the table to the `supabase_realtime` publication.
2. Supabase dashboard → Project Settings → API → JWT Settings → copy the **JWT
   Secret** into `SUPABASE_JWT_SECRET` (server-side only — see `.env.example`).
3. Confirm `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   are set.

**All of this is optional.** With `SUPABASE_JWT_SECRET` unset,
`/api/notifications/realtime-token` returns `enabled: false`, the bell falls
back to refreshing on window focus, and everything else works. You lose
instant-ness, not notifications.

### Why a minted JWT rather than Supabase Auth

Saji has its own bearer tokens, so there is no Supabase session and `auth.uid()`
is meaningless here. `/api/notifications/realtime-token` mints a 1-hour JWT
carrying a `saji_user_id` claim; the RLS policy reads it out of
`request.jwt.claims`. The browser gets **SELECT on its own rows only** — marking
read goes through the authenticated API, never the socket.

### If the bell shows nothing

- **Rows exist but no live push** → check `SUPABASE_JWT_SECRET`, then that
  `notifications` is in the publication:
  `select * from pg_publication_tables where tablename = 'notifications';`
- **No rows at all after an action** → the emit is upstream of delivery. Look
  for `[notify]` warnings in the server log; `emit()` swallows every failure.
- **Emails missing but rows present** → `notifications.emailed_at` is null.
  Either the user opted out, or Resend rejected the send (§4).
- **Duplicate emails** → a `dedupe_key` that is not deterministic. That is the
  bug, not the volume.

---

## 5. Testnet money (wallets need funding before contributing)

Each member who contributes needs, in their **own** Freighter wallet on
**Test Net**:

1. **XLM** for fees — free via Friendbot:
   `https://friendbot.stellar.org/?addr=<G...address>`
2. **A trustline** for the group's token (USDC/USDT) — XLM needs none.
3. **A balance** of that token — get it via `backend/scripts/fund-testnet.sh`
   (we control the USDC/USDT issuers on testnet so they can be minted), or a
   DEX swap.

Tokens (testnet SAC addresses live in `.env` + `src/lib/contract/tokens.ts`):
- **XLM** — native, no trustline
- **USDC / USDT** — self-issued test assets (issuers we control, mintable)

Swap these for real Circle-issued addresses via env before mainnet.

---

## 6. The group lifecycle (why "start cycle" / "contribute" can fail)

A rotating group must go through these steps IN ORDER — the contract enforces
it, so skipping a step gives a `HostError`:

1. **Create** (organizer signs) → group exists on-chain (Draft)
2. **Members join** (invite link) → they're `pending` in the DB
3. **Organizer Approves** each pending request (DB) → `approved`
4. **Organizer Admits on-chain** each member (organizer signs `join_group`)
5. **Start Cycle** (organizer signs) — needs **≥ 2 members on-chain** → Active
6. **Contribute** (each member signs) — needs the group **Active** + the member
   holding enough of the token (trustline + balance)
7. **Trigger Payout** — needs **everyone** to have contributed this cycle

Common contract errors decoded:
- `#5 WrongStatus` — group not in the right state (e.g. contribute before Active)
- `#6 AlreadyMember` — already admitted on-chain (no action needed)
- `#8 AlreadyContributed` — already paid this cycle
- `#10 TooFewMembers` — start_cycle with < 2 members on-chain
- `#13` + "trustline entry is missing" — the wallet has no trustline for the token

---

## 7. Going to production / mainnet (checklist)

One deployment now — app and API are the same Vercel project. No PHP, no
`stellar` CLI on the server, no VPS.

- Point `usesaji.com` at the Vercel project. Leave `NEXT_PUBLIC_API_URL` unset.
- **Google OAuth:** add the production URLs in Google Cloud Console
  (JS origin = the app, redirect URI = `<app>/api/auth/google/callback`).
- **Switch to mainnet:** `STELLAR_NETWORK=public` **and**
  `NEXT_PUBLIC_STELLAR_NETWORK=PUBLIC`, a mainnet RPC, a mainnet contract deploy,
  and real Circle USDC SAC/issuer addresses. Set each contract id under BOTH its
  server and `NEXT_PUBLIC_` name or unset one — they are cross-checked at
  startup (§3).
- Set `CRON_SECRET` so `/api/cron/chain-index` is not publicly triggerable.
- **Set `DIRECT_URL`, not just `DATABASE_URL`.** Vercel runs the `vercel-build`
  script, which starts with `prisma migrate deploy` so a deploy can never ship a
  client that is ahead of the database. That command reads `DIRECT_URL`
  (session mode, port 5432); through the 6543 transaction pooler the DDL fails.
  Local `pnpm build` deliberately does NOT migrate — it stays read-only against
  whatever database your `.env.local` points at.
- **Preview deployments run migrations too.** Vercel uses the same script for
  every deployment, so a preview branch pointed at the production database will
  migrate production. Give Preview its own database in the Vercel environment
  settings, or the first schema change on a feature branch lands in prod.

**Blockers that are still open — do not treat this list as "ready to ship":**

- **Image uploads do not work on Vercel.** `profile/avatar` and
  `groups/[id]/photo` write to `public/storage/` on the local filesystem, which
  is read-only in production. Needs object storage first.
- **Runtime DB connections use session mode, not the pooler**, which will
  exhaust connections under concurrency. See "Known gaps" in
  `src/server/ARCHITECTURE.md`.
- **Rate limiting is per-instance** (in-memory Map), so it is not a real global
  limit across serverless instances.

## 8. Contract deploy history (testnet)

Redeploying the savings contract mints a NEW contract ID and orphans all groups
on the old one (state does not migrate). After any deploy, update
`STELLAR_CONTRACT_ID` **and** `NEXT_PUBLIC_SAVINGS_CONTRACT_ID` in `.env.local`
(they must agree — see §3) plus `contractId` in
`src/lib/contract/savings/src/index.ts`, then restart `pnpm dev`.

Then verify both directions before trusting it:

```bash
pnpm check:bindings     # bindings vs. the DEPLOYED contract (needs stellar CLI)
pnpm check:call-sites   # hand-built server calls vs. the bindings (static)
```

Regenerate bindings with:

```bash
# from contract/
stellar contract build
stellar contract deploy --wasm target/wasm32v1-none/release/savings.wasm \
  --source-account saji-deployer --network testnet
# then, with the printed <NEW_ID>:
stellar contract bindings typescript --network testnet \
  --contract-id <NEW_ID> --output-dir <tmp>   # copy src/index.ts over the app's
```

| Date | Contract ID | Notes |
|---|---|---|
| (initial) | `CD3PEMVMMDIVKP5WIEOHLAPSDBE3AOMSEABETXHXRV2NQGOUYGDLHICD` | pre-default-handling |
| 2026-08-04 | `CA52T2UMMK6WJGIJXJ4LHBBS3HCVM5T22F6QRM57P2IQGLGQWVDYDFSF` | adds `resolve_default` (H1 fix), fee cap, member cap; deployer `saji-deployer` |
| 2026-08-05 | `CBK6LNFWWSKVYHVETO4FKX74JYKH22YMZBSF7CCQ6HK72AO7XS4HDLV2` | **claim-based payout** (`claim_payout`/`claimable_of`, payouts pull not push) + **one-signature launch** (`start_with_members`); 27 tests. NOTE: frontend/backend wiring for these two still TODO. |
| (unrecorded) | `CA3YEH744GMHOKALGS4YXFYXF3LT6XEPL5EPUF6DDWBJC2IDOFTT5LVT` | Deployed but never added to this table — noted here so the gap in the history is explicit. |
| 2026-08-11 | `CA3UA2T54JV4OCIKNTMBRNZFZFV6I4PYCWWZ4REY7LH4S7VGXIMPLXNH` | Deposit window (`CycleNotOpen`), recipient exemption (`RecipientExempt`), cycle-length floor/ceiling, late-fee cap at `MAX_FEE_BPS`, 7-day `resolve_default` escalation. **Storage-lease fix:** `TTL_EXTEND_TO` 90d → 175d and `MAX_CYCLE_LENGTH` 365d → 120d, so a cycle can never outlive its receipts' lease (see below). 40 tests; `check:bindings` + `check:drift` both OK. |

### The TTL ceiling — read before touching `TTL_EXTEND_TO`

The network caps any lease at `state_archival.max_entry_ttl`, which is
**3_110_400 ledgers = 180 days** at the 5s target close time. Read it with:

```bash
stellar network settings --network testnet   # → state_archival.max_entry_ttl
```

`bump_ttl` runs on EVERY state change, so a lease past that ceiling is rejected
by the host and **every call in the contract fails** — a total brick, not a
degradation. Two `const _: () = assert!(...)` guards in `savings/src/lib.rs` now
fail the BUILD if either invariant is broken:

1. `TTL_EXTEND_TO <= NETWORK_MAX_ENTRY_TTL`
2. `MAX_CYCLE_LENGTH` fits inside `TTL_EXTEND_TO`

If a future network raises `max_entry_ttl`, update `NETWORK_MAX_ENTRY_TTL` in
the contract to match before raising the lease.
