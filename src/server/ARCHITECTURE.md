# Next.js backend — architecture notes

Why this is shaped the way it is, and where it deliberately differs from the
Laravel backend it replaces.

## The one-line summary

Laravel needed a VPS because it shelled out to a Rust binary and ran a
long-lived scheduler process. Neither is inherent to the app — both were
workarounds for things PHP couldn't do in-process. The JS SDK and `after()`
remove them, which is what makes this deployable as a single Vercel project.

---

## Do we still need the cron?

**Yes, but it is a safety net, not the main path.** Worth being precise, since
it is the one piece of infrastructure that survived the migration.

The indexer exists because **the contract is the source of truth and it can
change without telling us**:

- a wallet signs `contribute` outside the app entirely
- a user closes the tab between "signed" and "reported back"
- `trigger_payout` fires on a cycle boundary with no user present
- an inline reconcile throws because the RPC was briefly down

No framework feature removes that. It follows from money living on-chain rather
than in our database.

What *has* changed is how much work the cron does. Every route that mutates
on-chain state calls `reconcileAfterResponse(groupId)`, which runs a targeted
reconcile via `after()` once the response is flushed. In the common case the DB
is correct within a second of the user's action and the cron finds nothing to
do. It earns its place only for the cases above.

**The cadence changed and it is a much bigger tradeoff than "doubled".** Laravel
ran `everyThirtySeconds()`. This runs **once a day**, at 00:00 UTC — see
`vercel.json`. That is not Vercel Cron's floor (Pro allows per-minute); it is
the Hobby plan's limit, and it is an accepted constraint, not an oversight.

Size your expectations to it. Worst-case background drift is ~24 hours, roughly
2900× the Laravel schedule, and that is the window that applies to **anything
the inline path does not catch**: a wallet contributing outside the app, a tab
closed mid-flow, an `after()` callback cut off by `maxDuration`. In those cases
a user sees stale state until the next midnight sweep.

The inline `reconcileAfterResponse` path is what makes this liveable, and it is
best-effort by construction — it swallows its own failures. So the honest
summary is: **user-initiated actions reconcile in about a second; everything
else can take a day.** If that stops being acceptable, the fix is Vercel Pro
(per-minute cron) or an external scheduler hitting the same authenticated
endpoint — not a persistent worker, which serverless still cannot host.

---

## What replaced what

| Laravel | Here | Why |
| --- | --- | --- |
| `stellar` CLI via `Process::run()` | `@stellar/stellar-sdk` in-process | No binary, no `exec()`, no VPS. This was the blocker. |
| `exec("artisan chain:index &")` | `after()` | First-class post-response work. PHP-FPM had no equivalent, hence the subprocess. |
| `Schedule::everyThirtySeconds()` | Vercel Cron, 1/day | No long-lived process on serverless; 1/day is the Hobby plan's limit. |
| Sanctum tokens | `AccessToken` + SHA-256 | Same bearer scheme, so the frontend is unchanged. |
| `config/cors.php` | `src/proxy.ts` | Runs at the edge; preflight never wakes the DB. |
| Eloquent + migrations | Prisma | Schema ported 1:1, constraints included. |
| FormRequest validation | Zod | Same `{ message, errors }` 422 shape the frontend already parses. |
| `$hidden` on the model | `publicUser()` | Prisma has no implicit hiding — see the warning below. |

---

## Things that are load-bearing

**`publicUser()` is not optional.** Laravel's `$hidden` kept `password` out of
every response automatically. Prisma serialises every column, so returning a
bare `user` object leaks the password hash. Every route that returns a user must
pass it through `publicUser()` first.

**Money is strings, never numbers.** `Decimal(20, 7)` in the schema, decimal
strings over the wire, `BigInt` stroops on-chain. A JSON number is an IEEE-754
double and cannot represent every 7-dp value exactly; the error lands in a user
balance. `toStroops()` rejects anything with more than 7 decimal places rather
than rounding.

**Unique constraints are correctness, not tidiness.**
`contributions(group_id, user_id, cycle)` and `payouts(group_id, cycle)` are what
stop a retry from recording the same money twice.
`challenge_deposits.stellar_tx_hash` stops one transfer counting as two saves.

**The indexer must stay idempotent.** It is safe to run overlapping or retried
only because a second run over unchanged state does nothing.

**`recordOnchain` distinguishes "unverified" from "verified wrong".** If the RPC
read fails we record provisionally and let the indexer correct it. Returning an
error instead would make the client retry, and each retry signs a *new*
`create_group` on-chain — orphan groups and real gas burned. Read the comments
there before changing that flow.

**The chain decides what is `confirmed`, never the client.**
`/groups/[id]/contributions/confirm` does not take the caller's word that they
paid — it runs the indexer, which reads `has_contributed` from the contract. A
member cannot mark themselves paid without a real on-chain transfer.

**Ownership checks return 404, not 403.** A withdrawal destination or
transaction belonging to another user 404s, matching the Laravel behaviour. A
403 confirms the id exists, which lets a caller enumerate other users' rows.

**Two visibility levels, and they are not interchangeable.** `assertVisible`
covers *seeing* a group — challenges and public circles are open to everyone,
and pending requesters can see what they asked to join. `assertApprovedMember`
covers *acting* on one (contributing, depositing) and is strictly narrower.

**Contract argument ORDER is load-bearing, and TypeScript cannot see it.**
Every hand-built call in `stellar/service.ts` passes a positional
`xdr.ScVal[]`. Every element has the same TS type, so swapping two of them
compiles perfectly and then fails at simulation on *every* call. This is not
hypothetical — it shipped:

```
contract:  has_contributed(group_id: u64, cycle: u32, member: Address)
server:    ["has_contributed", [u64(groupId), addr(member), u32(cycle)]]   // wrong
```

The indexer caught that throw and `continue`d, so the symptom was not an error
but silence: no contribution was ever confirmed, no cycle ever completed, no
payout ever fired, and the sweep reported `errors: 0` throughout.

The root cause is worth naming, because it will recur otherwise: **Laravel
passed NAMED arguments** through the CLI (`['group_id' => …, 'cycle' => …]`),
where order could not matter. Nothing about the positional ScVal form preserves
that property. `scripts/check-call-sites.mjs` now checks it statically against
the generated bindings, and runs in CI. Note it is a *different* check from
`check-contract-bindings.mjs`: that one compares bindings against the deployed
contract and would not have caught this, because the bindings were correct all
along — it was the server's hand-written calls that were wrong.

**Contract enum ordinals are load-bearing and easy to get backwards.**
`PayoutOrder` is `Manual=0, Random=1, Vote=2, Custom=3` and `LatePenalty` is
`DeductFromBalance=0, RemoveMember=1` — read straight from the generated
bindings in `src/lib/contract/savings/src/index.ts`, which is the only
authority for this. An earlier draft of `PAYOUT_ORDER_VARIANT` had Random and
Manual swapped; passing the wrong ordinal doesn't error, it just creates a
group with a different rotation policy than the user chose. If you touch that
map, re-read the bindings file first.

**`join_group` is signed by the ORGANIZER, not the joining member.** The
member being admitted is a separate argument. An earlier draft of
`buildJoinGroupTx` took the member as the transaction source, which would have
built a transaction the contract rejects outright — safe-fails, but worth
knowing the shape of the mistake if a similar function is added later.

---

## Non-custodial boundary

Unchanged from Laravel, and the most important invariant in the codebase.

The backend **never holds a user's secret key and never signs for them**.
Anything moving a user's money is built as unsigned XDR and returned for their
wallet to sign.

The single exception is `triggerPayout`, signed by the service account. That is
safe because the contract lets it pay only the rules-determined recipient — a
compromised backend cannot redirect funds. It still refuses to run without
`STELLAR_SERVICE_SECRET`; the backend must never fabricate authority it wasn't
given.

---

## Verified against a live database

The auth + groups slice was driven end to end against a real Supabase project
(register → OTP verify → complete profile → login → `/auth/me` → create group
→ list groups), not just typechecked. Two real bugs surfaced that no amount of
static checking would have caught:

**`$transaction` needs a session-mode connection, not the transaction
pooler.** `DATABASE_URL` (Supabase's `:6543?pgbouncer=true`) recycles the
underlying connection between statements, so an interactive
`prisma.$transaction(async (tx) => …)` fails outright with P2028 ("Unable to
start a transaction in the given time") the moment it's opened. `db.ts` now
connects with `DIRECT_URL` (`:5432`, session mode) for everything, since every
route that touches money uses `$transaction` for a real correctness reason.
This is a genuine constraint on hosting, not a workaround: this app needs a
session-capable Postgres connection at RUNTIME, not only at migrate time —
factor that into the connection-pooling gap below.

**Even on the direct connection, expect occasional P2028 on Supabase's free
tier.** One `$transaction` call failed on first attempt and succeeded
immediately on retry, with nothing else different — a slow connection handoff
under Supabase's pooler, not a bug. `transactionOptions.timeout`/`maxWait` in
`db.ts` are raised from Prisma's 5s default to 15s to absorb this. If P2028
recurs in production, that's the first place to look — and a paid tier or a
different Postgres host may simply not have this behavior.

## Known gaps in this slice

Honest list of what is not done or not production-ready.

1. **Rate limiting is per-instance.** `rateLimit()` uses an in-memory Map, so
   serverless instances don't share a window. It blunts naive brute force but is
   not a real global limit. Move to Upstash Redis before mainnet; call sites
   won't change.
2. **Uploads write to the local filesystem and that does not work on Vercel.**
   `profile/avatar` and `groups/[id]/photo` `writeFile` into `public/storage/`
   and store a `/storage/…` path. Vercel's filesystem is read-only outside
   `/tmp`, and `/tmp` is per-instance and ephemeral — so the write fails, or
   succeeds somewhere the next request cannot read. This is the one place the
   "deployable as a single Vercel project" claim above does not hold. Needs
   object storage (Vercel Blob / S3 / Supabase Storage).
3. **`after()` runs within the invocation's `maxDuration`.** A very slow
   reconcile could be cut off. With the sweep at 1/day (see above) that is less
   harmless than it sounds: the correction may not arrive until midnight.
   `after()` is not a queue. Anything that genuinely must complete needs a real
   job runner.
5. **The runtime client now uses the DIRECT (session-mode) connection, not the
   pooler** — see "Verified against a live database" above for why. That
   trades away exactly the protection the pooler exists for: serverless opens
   one connection per instance, and a session-mode Postgres has a hard cap on
   concurrent sessions (Supabase free tier: ~60). This WILL exhaust under any
   real concurrent load. Before shipping past a handful of users, either (a)
   move the interactive `$transaction` calls to Prisma's `queryRaw`-based
   advisory locks so plain pooled queries suffice, or (b) put PgBouncer in
   session mode in front of a larger connection cap. Don't deploy multiple
   serverless instances against the current setup without addressing this.

   Note the auth path amplifies this: `userFromRequest` does a token lookup plus
   a `lastUsedAt` write on **every** authenticated request, so the floor is two
   round trips per request before any handler work. And `withTransaction`
   retrying P2028 three times will mask genuine connection exhaustion as
   latency rather than surfacing it as an error — if requests get slow before
   they get failures, look here first.

6. **No test suite.** The contracts have `test.rs`; this layer — which now owns
   every money decision the database makes — has none. CI runs `typecheck`,
   `lint`, and `check:call-sites` (see `.github/workflows/ci.yml`), which are
   static gates only. The gap that matters most is an integration test that
   exercises `runIndexer` against a testnet fixture group: that is the one that
   would have caught the `has_contributed` argument-order bug on day one.

## Retired: the Laravel backend

`backend/` is **no longer served and no longer part of the running system.**
Every route it exposed now lives in `src/app/api`, including the two that were
briefly listed as unported (Google OAuth and statement export — both are done;
statement is CSV, PDF was dropped). It is kept in the tree for reference while
the port beds in. Nothing in it runs, and `php artisan schedule:work` is no
longer a thing anyone needs to start — the reconciler is `runIndexer`, driven by
`after()` and Vercel Cron.
