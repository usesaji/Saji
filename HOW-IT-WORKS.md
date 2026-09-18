# How Saji Works — End to End

A complete walkthrough of the Saji product: what a user sees on every screen, what
the frontend does behind each button, what the backend records, and what actually
moves money on the blockchain.

This document is written from the code, not from a spec. Where the code and the
intuitive expectation differ (and they do, in a few important places), the code
wins and the difference is called out.

> ### ⚠️ Read this first: "Laravel" below means "the backend"
>
> This document was written against the **Laravel** backend, which has since
> been **replaced by Next.js route handlers** in `src/app/api` (+ `src/server`,
> Prisma, Postgres). `backend/` no longer runs — see `backend/RETIRED.md`.
>
> The product behaviour, the data-vs-chain split, and every flow described here
> are still accurate; they were ported deliberately. What is NOT accurate is any
> mention of Laravel internals as things that exist today. Read them as "the
> backend does X":
>
> | Where it says | Read as |
> | --- | --- |
> | Laravel `users` / `group_members` / Eloquent | the Postgres tables via Prisma |
> | Laravel Socialite | `src/server/oauth.ts` |
> | Sanctum tokens | `src/server/auth.ts` (bearer + SHA-256; same wire format) |
> | `php artisan chain:index` / `schedule:work` | `runIndexer()`, via `after()` + Vercel Cron |
> | `backend/routes/api.php` | the route files under `src/app/api` |
>
> **One behavioural difference is real and is not a renaming:** the reconciler
> used to run every 30 seconds. It now runs inline after each mutating request,
> and otherwise **once a day**. Anything that happens outside the app can be
> stale for up to 24 hours. Sections 16 and 17 have been corrected; older
> passages still describing a ~30-second lag are wrong on timing.
>
> `src/server/ARCHITECTURE.md` is the current authority on the backend.

---

## Table of contents

1. [The one-paragraph summary](#1-the-one-paragraph-summary)
2. [The three-layer architecture](#2-the-three-layer-architecture)
3. [Key concepts you must understand first](#3-key-concepts-you-must-understand-first)
4. [Flow 1 — Signing up and logging in](#4-flow-1--signing-up-and-logging-in)
5. [Flow 2 — Connecting a wallet (this replaces "deposit")](#5-flow-2--connecting-a-wallet-this-replaces-deposit)
6. [Flow 3 — Creating a group](#6-flow-3--creating-a-group)
7. [Flow 4 — Inviting and joining](#7-flow-4--inviting-and-joining)
8. [Flow 5 — Starting the circle](#8-flow-5--starting-the-circle)
9. [Flow 6 — Contributing (the real "deposit")](#9-flow-6--contributing-the-real-deposit)
10. [Flow 7 — The payout](#10-flow-7--the-payout)
11. [Flow 8 — Withdrawing](#11-flow-8--withdrawing)
12. [Flow 9 — Defaults and late payments](#12-flow-9--defaults-and-late-payments)
13. [Flow 10 — Completion](#13-flow-10--completion)
14. [Supporting screens](#14-supporting-screens)
15. [The full page map](#15-the-full-page-map)
16. [How state stays in sync](#16-how-state-stays-in-sync)
17. [Running it locally](#17-running-it-locally)

---

## 1. The one-paragraph summary

Saji is a digital **rotating savings circle** (an *ajo* / *esusu* / ROSCA). A group
of people agree to contribute a fixed amount on a fixed schedule. Each cycle, the
entire pool goes to one member, rotating until everyone has had a turn. Saji runs
the money side on the **Stellar blockchain** via a Soroban smart contract, so no
company ever holds member funds — contributions are escrowed by the contract and
released only on the recipient's own signature. The Laravel backend stores the
social layer (accounts, groups, invites, history) and mirrors on-chain state so
the UI has something fast to read. The Next.js frontend talks to both, and asks
the user's browser wallet to sign anything that moves money.

---

## 2. The three-layer architecture

```
┌───────────────────────────────────────────────────────────────────┐
│  FRONTEND — Next.js (this repo root, src/)                        │
│  • All pages, all UI                                              │
│  • Holds the Sanctum bearer token in localStorage                 │
│  • Talks to the wallet (Stellar Wallets Kit)                      │
│  • Calls the contract DIRECTLY for anything that moves money      │
│  • Reads Horizon + Soroban RPC directly from the browser          │
└──────────────┬────────────────────────────────┬───────────────────┘
               │ REST (JSON, Bearer token)      │ signed transactions
               ▼                                ▼
┌──────────────────────────────┐   ┌────────────────────────────────┐
│  BACKEND — Laravel           │   │  CHAIN — Soroban / Stellar     │
│  backend/                    │   │                                │
│                              │   │  savings contract (circles)    │
│  • Users, OTP, Google OAuth  │   │  • create_group                │
│  • Groups + members + invite │   │  • join_group                  │
│  • Contribution/payout rows  │◄──┤  • start_cycle                 │
│  • Transaction history       │   │  • contribute   (escrow in)    │
│  • Withdraw destinations     │   │  • trigger_payout (earmark)    │
│  • ChainIndexer (reconciler) │──►│  • claim_payout (escrow out)   │
│                              │   │  • resolve_default             │
│                              │   │                                │
│                              │   │  challenge contract (savings)  │
│                              │   │  • deposit      (escrow in)    │
│                              │   │  • withdraw     (escrow out)   │
│                              │   │  • balance_of                  │
└──────────────────────────────┘   └────────────────────────────────┘
       Two contracts = two token balances. A bug in one cannot
       reach the other's escrow. See §14.4.
```

**The governing rule:** the backend is *never* the source of truth for money. It
is a cache and a social/history layer. Every figure that represents value is read
from the chain, and every action that moves value is signed by the user's own
wallet.

### Where each responsibility lives

| Concern | Owner | Why |
|---|---|---|
| Who you are | Laravel (`users`) | Chain has no identity |
| Your wallet address | Laravel (public key only) | Needed to map chain ↔ user |
| Group name, photo, description | Laravel | Not worth chain storage |
| Group *rules* (amount, fees, order) | **Both** | Laravel for display, chain for enforcement |
| Who is a member | **Chain** (Laravel mirrors) | Determines who can pay/receive |
| Money in escrow | **Chain only** | Non-custodial guarantee |
| Whose turn it is | **Chain only** | Can't be gamed |
| Transaction history | Laravel | Chain data isn't queryable enough |
| Your withdrawable balance | **Chain** (read in browser) | See §11 for why not the backend |

### Key files

| Layer | File | Role |
|---|---|---|
| API client | [src/lib/api/index.ts](src/lib/api/index.ts) | Every backend call, one place |
| Wallet | [src/lib/wallet/index.ts](src/lib/wallet/index.ts) | Connect, sign, Horizon reads, payments |
| Contract calls | [src/lib/hooks/useSavingsContract.ts](src/lib/hooks/useSavingsContract.ts) | Every contract method |
| Balance | [src/lib/hooks/useSajiBalance.ts](src/lib/hooks/useSajiBalance.ts) | Withdrawable money, browser-side |
| Live chain state | [src/lib/hooks/useLiveCircle.ts](src/lib/hooks/useLiveCircle.ts) | Instant circle state |
| Tokens | [src/lib/contract/tokens.ts](src/lib/contract/tokens.ts) | XLM/USDC/USDT addresses |
| Routes | [src/config/routes.ts](src/config/routes.ts) | Every page URL |
| Backend routes | [backend/routes/api.php](backend/routes/api.php) | Every endpoint |
| Contract (circles) | [contract/contracts/savings/src/lib.rs](contract/contracts/savings/src/lib.rs) | Rotation rules, in Rust |
| Contract (challenges) | [contract/contracts/challenge/src/lib.rs](contract/contracts/challenge/src/lib.rs) | Personal savings vaults |
| Reconciler | [backend/app/Services/Stellar/ChainIndexer.php](backend/app/Services/Stellar/ChainIndexer.php) | Chain → DB sync + auto-payout |

---

## 3. Key concepts you must understand first

Four things in Saji work differently from what the words suggest. Understanding
these up front makes every flow below obvious.

### 3.1 There is no "deposit" in the normal sense

There is **no Saji-controlled account you send money to**. No deposit address, no
bank transfer, no card, no fiat on-ramp. Instead:

> **You connect your own Stellar wallet, and when you contribute, the contract
> pulls the exact contribution amount from your wallet with your signature.**

Your money sits in your own wallet until the moment a contribution is due. That
moment *is* the deposit. This is what `backend/routes/api.php:76-78` means by
"Funding is connect-wallet + sign (the contract pulls funds directly) — there is
no deposit-address or fiat on-ramp step."

So "how do I deposit?" has two real answers:
- **Fund your own wallet** — buy XLM/USDC/USDT anywhere and send it to your
  wallet. Saji is not involved at all. (On testnet, see `backend/scripts/fund-testnet.sh`.)
- **Contribute to a circle** — the in-app action that moves money. See §9.

### 3.2 The payout is *pull-based*, not pushed

When a cycle completes, the contract does **not** send money to the recipient's
wallet. It marks the amount as **claimable** and leaves it escrowed
(`lib.rs:517-522`). The recipient later signs `claim_payout` to release it.

This is deliberate and it's why "withdraw" exists as a distinct action:

- **Push** would mean the contract can move funds to a wallet without that
  person's consent. Custodial-flavoured, and it breaks if their wallet can't hold
  the asset.
- **Pull** means funds only ever move on the owner's own signature, and the
  recipient chooses the destination — including a wallet that isn't the one they
  contribute from.

Consequence: after your turn, the money **is yours but is still in the contract**.
It shows in your Saji Balance. It reaches a wallet when you withdraw.

### 3.3 Two membership lists, and both matter

A member exists in two places, and the difference causes most organizer confusion:

| | Where | Set by | Meaning |
|---|---|---|---|
| **DB member** | Laravel `group_members` | Join link + organizer approval | "Allowed in the app" |
| **Chain member** | Contract `Members(group_id)` | Organizer signs `join_group` | "Can actually pay and receive" |

Being a DB member is *not* enough to contribute. The organizer must also add you
on-chain — the contract requires the **organizer's** signature for `join_group`
(`useSavingsContract.ts:96-98`), not the joiner's. This is why the organizer
checklist in [src/app/(webapp)/groups/[groupId]/page.tsx](src/app/(webapp)/groups/[groupId]/page.tsx#L534-L536)
says "Step 1 · Approve" then "Step 2 · Add to chain".

### 3.4 Every asset has a trustline requirement

Stellar accounts can only hold assets they've explicitly *trusted*. Native XLM
needs no trustline; **USDC and USDT do**. A payment of an untrusted asset is
rejected by the network.

This shows up in three places:
- Before you contribute, the app opens a trustline for the group's asset if you
  don't have one ([circle/page.tsx:135-143](src/app/(webapp)/groups/[groupId]/circle/page.tsx#L135-L143)).
- Before you withdraw, the app checks the **destination** has a trustline — you
  cannot create one on someone else's account, so it fails early with a clear
  message ([withdraw/page.tsx:141-151](src/app/(webapp)/wallet/withdraw/page.tsx#L141-L151)).
- If a claim destination lacks a trustline, the whole claim reverts and the payout
  stays safely escrowed (`lib.rs:635-637`).

---

## 4. Flow 1 — Signing up and logging in

### 4.1 The landing page

`/` — [src/app/(landing)/page.tsx](src/app/(landing)/page.tsx). Marketing:
hero, about, reviews, FAQ, CTA. Both CTAs lead to `/auth/register`.

### 4.2 Registration — three steps, three pages

Saji verifies the email **before** it creates an account. Nothing is written to
`users` until step 3.

```
/auth/register  ──►  /auth/register/verify-otp  ──►  /auth/register/create-profile  ──►  /overview
   email only          4-digit code                    name, tag, password
```

**Step 1 · Email** ([RegisterForm.tsx](src/features/auth/components/RegisterForm.tsx))

The user enters only an email address. On submit:

```
POST /api/auth/register/start   { email }
→ { message, expires_in_minutes }
```

The backend mails a 4-digit code and stores it in `otp_codes`. The frontend saves
the email to `sessionStorage` (via [signup-session.ts](src/lib/auth/signup-session.ts))
so a page refresh doesn't lose it, and navigates to the OTP page with the email in
the query string as well.

*Throttled at 6 requests/minute* (`api.php:31`) — these endpoints send mail, so
they're the natural target for mail-bombing.

**Step 2 · OTP** ([VerifyOTPForm.tsx](src/features/auth/components/VerifyOTPForm.tsx))

Four large input boxes; typing auto-advances. On submit:

```
POST /api/auth/register/verify-otp   { email, otp }
→ { signup_token }
```

The `signup_token` is short-lived proof that this email was verified. It goes into
`sessionStorage`. There's a "Resend OTP" link that re-calls step 1.

**Step 3 · Profile** ([CreateProfileForm.tsx](src/features/auth/components/CreateProfileForm.tsx))

Name, tag name (`@handle`), password + confirmation. On mount it checks the signup
token still exists and bounces back to `/auth/register` if not. On submit:

```
POST /api/auth/register/complete-profile
  { signup_token, name, tag_name, password, password_confirmation }
→ { user, token }
```

**This is where the account is created.** The returned Sanctum bearer token is
written to `localStorage` under `saji_token`, the signup session is cleared, and
the user lands on `/overview` — logged in.

### 4.3 Login

`/auth/login` — [LoginForm.tsx](src/features/auth/components/LoginForm.tsx). Email +
password, validated live with Zod.

```
POST /api/auth/login   { email, password }
→ { user, token }
```

Token stored, redirect to `/overview`. Laravel returns credential failures keyed
on `email`, and the form deliberately re-surfaces them **on the field** rather than
only as a toast, so the error appears where the user is looking.

### 4.4 Google sign-in

[GoogleAuthBtn.tsx](src/features/auth/components/GoogleAuthBtn.tsx) does a full-page
navigation (not fetch — OAuth needs real redirects) to
`{API_URL}/api/auth/google/redirect`. Laravel Socialite handles the round trip and
redirects back to `/auth/google/callback` with a token in the URL. That page stores
the token and forwards to `/overview`.

Failures come back as `?error=google` or `?error=google_no_email` on the login
page, which maps them to readable toasts (`LoginForm.tsx:26-29`).

### 4.5 How auth is enforced afterwards

Every authenticated page lives under the `(webapp)` route group, whose layout wraps
children in [AuthGuard](src/features/auth/components/AuthGuard.tsx):

```tsx
if (!getToken()) router.replace("/auth/login");
if (!checked)   return <PageLoading />;   // never flash protected UI
return children;
```

The check must run **client-side** — the token is in `localStorage`, which no
server component or middleware can read. That's why there's a brief loading state
rather than a server redirect.

Every API call with `auth: true` attaches `Authorization: Bearer <token>`
([api/index.ts:106-109](src/lib/api/index.ts#L106-L109)).

---

## 5. Flow 2 — Connecting a wallet (this replaces "deposit")

**Page:** `/wallet` — [src/app/(webapp)/wallet/page.tsx](src/app/(webapp)/wallet/page.tsx)

Until a wallet is connected, the user can browse but cannot move any money. The
wallet card shows "No wallet linked yet." with a **Connect Wallet** button.

### What happens on click

[WalletConnectButton](src/features/wallet/WalletConnectButton.tsx) → `useWallet().connect()`:

1. **Stellar Wallets Kit opens a picker modal** listing installed wallets —
   Freighter, Albedo, xBull, Lobstr, Hana ([wallet/index.ts:31-41](src/lib/wallet/index.ts#L31-L41)).
2. The user picks one and approves the connection in that wallet's own UI.
3. The kit returns **only the public address** (`G…`, 56 chars).
4. The frontend links it to the account:
   ```
   PATCH /api/profile/wallet   { stellar_address: "G…" }
   ```

The private key never leaves the user's wallet. Saji never sees it, never stores
it, and cannot construct a transaction the user hasn't approved. `PATCH
/api/profile/wallet` accepts a public address and nothing else
([api.php:56-57](backend/routes/api.php#L56-L57)).

Once linked, the card shows `Linked · GABC…WXYZ` with a Disconnect link.

### Funding the wallet

Saji has no on-ramp. Users fund their own wallet externally. What matters for Saji:

- The wallet needs enough of the **group's chosen asset** to cover contributions.
- For USDC/USDT it needs a **trustline** for that asset (the app will offer to
  create it — see §9).
- It needs a little **XLM** regardless, for network fees and the account reserve.

That XLM reserve is a real Stellar rule, not a Saji one: every account must retain
1 XLM plus 0.5 per subentry. [spendableBalance()](src/lib/wallet/index.ts#L180-L200)
subtracts it so the "Max" button can never build a transaction the network will
reject with `op_underfunded`.

### The wallet page as a whole

| Section | Component | Shows |
|---|---|---|
| Savings summary | [SavingsSummaryCard](src/features/overview/SavingsSummaryCard.tsx) | Total saved across circles |
| **Saji Balance** | [SajiBalanceCard](src/features/wallet/SajiBalanceCard.tsx) | Withdrawable money + the Withdraw CTA |
| Wallet address | inline | Linked address / connect button |
| Recent activity | [RecentActivities](src/features/overview/RecentActivities.tsx) | Latest events |
| Insights | [UsefulInsights](src/features/wallet/UsefulInsights.tsx) | Savings tips |
| Upcoming contribution | [UpcomingContribution](src/features/wallet/UpcomingContribution.tsx) | Next payment due |
| Wallet history | inline | Full transaction list |

---

## 6. Flow 3 — Creating a group

**Entry:** the floating **+** button, or `/groups` → Create.
**Page:** `/groups/create` → [CreateGroupForm.tsx](src/features/group/CreateGroupForm.tsx)

A four-step wizard (three input steps + a success screen) with a progress bar.

### Step 1 · Basics

| Field | Notes |
|---|---|
| Group Name | Required |
| Description | Optional |
| Save in (currency) | USDC (default), USDT, or XLM — **locked for the circle's life** |
| Contribution Amount | Required, > 0. What each member pays each cycle |
| Target Amount | Optional, display only |
| Contribution Frequency | Daily / Weekly / Bi-weekly / Monthly / Custom |
| Cycle Length (days) | Only shown when frequency is Custom |
| Group Type | Private (default) or Public |

**Continue** is disabled until name and amount are valid.

### Step 2 · Group Rules

- **Late Fee (%)** and **Service Charge (%)** — two coloured cards. Note the
  in-form clarification: the late fee is applied *when a payout is settled*, not
  deducted the moment a payment is late.
- **Grace Period (days)** — a −/+ stepper, default 3.
- **Payout Order** — four tiles: Random, Manual (default), Vote, Custom.
- **Auto Approval** — join requests admitted without organizer review.
- **Contribute Privacy** — hide member balances from each other.
- **Late penalty policy** — `Deduct from balance` (accrue a fee) or
  `Remove member` (eject + refund). The contract enforces whichever is chosen.

### Step 3 · Review

A read-only summary: target, currency, contribution, group type, payout order,
frequency, service charge, and the late penalty rendered in red.

### What "Confirm & Create" actually does

Three sequential operations ([CreateGroupForm.tsx:244-318](src/features/group/CreateGroupForm.tsx#L244-L318)):

```
1. POST /api/groups  { …all settings }
   → creates the DB row.  Percentages → basis points (1% = 100 bps),
     grace days → hours, before sending.

2. contract.create_group({ organizer, token, amount, cycle_length,
                           fee_bps, late_fee_bps, grace_period,
                           payout_order, late_penalty })
   → WALLET SIGNATURE PROMPT.  Returns the on-chain group id.

3. PATCH /api/groups/{id}/onchain  { onchain_group_id }
   → links the two together.
```

Unit conversions happen at the boundary: amounts become **stroops** (×10,000,000),
cycle length becomes **seconds** (days × 86,400), grace becomes seconds
(hours × 3,600) — see [useSavingsContract.ts:12-14, 55-66](src/lib/hooks/useSavingsContract.ts#L55-L66).

**Step 2 is wrapped in its own try/catch and failure is non-fatal.** If no wallet
is connected, or the user rejects the signature, the DB group still exists with
`onchain_group_id = null`. The wizard proceeds to success. This is a deliberate
trade-off — it avoids losing a filled-in form — and it's recovered by the
"Activate on-chain" panel described in §8.1.

### Step 4 · Success

A big green check, "Your Savings Group is Active", and the **invite link** with a
copy button. The link is fetched via `GET /api/groups/{id}/invite-link` and falls
back to constructing `{origin}/groups/join/{token}` if that call fails.

---

## 7. Flow 4 — Inviting and joining

### 7.1 Circles are invite-only

There is no join-by-id endpoint. [api.php:109](backend/routes/api.php#L109) states
it plainly: *"Joining is LINK-ONLY."* The only way in is
`/groups/join/{token}`. (Public **challenges** are different — see §14.4.)

### 7.2 The join page

`/groups/join/[token]` — [page.tsx](src/app/(webapp)/groups/join/[token]/page.tsx)

```
GET /api/groups/join/{token}   → public-safe preview
```

The invitee sees the group name, description, banner, target goal, member count,
contribution amount, and the four settings rows (Group Type, Payout Order,
Frequency, Late Penalty — the last in red). At the bottom, a panel that reads
either *"This circle admits members instantly"* or *"The organizer will confirm
your request to join"* depending on `auto_approve_join`.

**Join Group** →

```
POST /api/groups/join/{token}
→ GroupMember { status: "pending" | "approved" }
```

The toast branches on the returned status: *"You're in — welcome to the circle"*
vs *"Request sent — the organizer will approve you."* Then it routes to the group
page.

### 7.3 The organizer reviews requests

Pending requests surface in two places:

- **Inline** on the circle page via [PendingRequests](src/features/group/PendingRequests.tsx),
  capped at 2 with a "View All".
- **Full page** at `/groups/{id}/requests`.

```
POST   /api/groups/{id}/members/{memberId}/approve   → approve
DELETE /api/groups/{id}/members/{memberId}           → decline
```

Approving is a **DB-only** operation. It makes them a member of the app. It does
not yet let them contribute — that's step 2, below.

---

## 8. Flow 5 — Starting the circle

**Page:** `/groups/{groupId}` — [page.tsx](src/app/(webapp)/groups/[groupId]/page.tsx)

This page is the "forming" view. Once the circle goes active it
**auto-redirects** to `/groups/{id}/circle` (line 112-116), so the forming UI never
appears for a running circle. The organizer can force it back with `?manage=1`.

### 8.1 Recovery: "Activate your circle on-chain"

If `onchain_group_id` is null (the group creation's step 2 failed), the organizer
sees an amber panel. Its **Activate on-chain** button re-runs `create_group` +
`recordOnchain` — the same work the wizard does, but here with real error messages
instead of a silent catch ([page.tsx:188-232](src/app/(webapp)/groups/[groupId]/page.tsx#L188-L232)).

Until this succeeds, members cannot be admitted and the cycle cannot start.

### 8.2 The organizer setup checklist

A four-item checklist that shows exactly where the organizer is:

```
☐ N join requests awaiting approval    (→ ✓ when all reviewed)
☐ N members added to the chain         (need at least 2)
☐ Set the payout order — this locks when you start
☐ Start the cycle
```

Below it, the member list. Each row shows a name, wallet address, and a
context-appropriate action:

| Member state | What the organizer sees |
|---|---|
| Pending join request | **Step 1 · Approve** + "then add to chain" |
| Approved, no wallet linked | "Waiting for their wallet" |
| Approved, has wallet, not on chain | **Step 2 · Add to chain** |
| On chain | ✓ On-chain badge |
| On chain, cycle running | ✓ On-chain + **Resolve default** |
| Cycle already started, not on chain | "Joining closed" |

**Step 2 · Add to chain** calls `contract.join_group(groupId, memberAddress)`.
The **organizer** signs — the contract requires it. The frontend translates the
two common contract errors into plain language: `#6 AlreadyMember` → "already
on-chain, no action needed"; `#5 WrongStatus` → "joining is closed, the cycle
already started" ([page.tsx:143-161](src/app/(webapp)/groups/[groupId]/page.tsx#L143-L161)).

The member list state is read **live from the chain**, not from the DB, via
`getOnchainState()` — so the ✓ badges reflect actual contract storage.

### 8.3 Set the payout order

`/groups/{id}/payout-order` — a drag-and-drop list. The order is
`contract.set_payout_order(groupId, [addresses])`, organizer-signed, and must be a
permutation of the current on-chain members.

**This locks when the cycle starts.** The checklist says so, and the button copy
below the Start button reinforces it. Set it first.

### 8.4 Start the cycle

**Start Cycle** is disabled until at least 2 members are on-chain.

```
contract.start_cycle(onchain_group_id)    ← organizer signs
POST /api/groups/{id}/activate            ← DB status sync
```

The contract flips the group to `Active` (status 2), joins close permanently, and
members can contribute. The error mapping here is unusually thorough
([page.tsx:246-273](src/app/(webapp)/groups/[groupId]/page.tsx#L246-L273)):

| Contract error | Message shown |
|---|---|
| `#10 TooFewMembers` | "You need at least 2 members added on-chain before starting." |
| `#5 WrongStatus` | "…may already be active or completed." |
| auth failure | "Only the organizer's wallet can start the cycle." |
| user rejected | "You cancelled the signature." |
| no wallet | "Connect your wallet first…" |

Once started, everyone is redirected to the circle page.

---

## 9. Flow 6 — Contributing (the real "deposit")

**Page:** `/groups/{groupId}/circle` — [page.tsx](src/app/(webapp)/groups/[groupId]/circle/page.tsx)

This is where members spend their time.

### 9.1 What the page shows

**Total Group Savings** — a purple card with the pooled amount and an eye toggle to
hide it, plus a Circle Progress bar (cycles done / cycles total).

**Payout Rotation** — a horizontal strip of avatars in payout order. The current
recipient has a purple dot; removed members are greyed out, struck through, and
labelled "Removed". Each has a caption: "Current" or "Next Cycle".

**Cycle Activity** — a list of on-chain events with timestamps and "View
Transaction" links to the block explorer. Empty state: "No Activity yet".

**Pending requests** — organizer only, capped at 2.

**This cycle** — a grey panel naming who receives this cycle's payout, with "(you)"
appended if it's the viewer, and an explanation that the pool is earmarked once
everyone has paid.

**The contribute button** — full width. Its label adapts: *Make First Payment* →
*Make a Payment* → *You've paid this cycle* (disabled).

**Onboarding modals** — on the first visit to a brand-new circle, two modals
appear: "You get alerted 72 hours before" and "Payout takes 3–5 minutes". Dismissal
is stored in `localStorage` under `saji:onboarded:circle:{groupId}`, so they appear
exactly once per circle.

### 9.2 What happens when you contribute

Four steps ([circle/page.tsx:122-186](src/app/(webapp)/groups/[groupId]/circle/page.tsx#L122-L186)):

```
0. Guard        — if onchain_group_id is null → "This circle isn't live on-chain
                  yet. The organizer must activate it first."

1. Trustline    — if the group's asset is USDC/USDT and your wallet doesn't trust
                  it, build + sign a change_trust transaction.
                  (SIGNATURE #1, only the first time)

2. POST /api/groups/{id}/contributions
                  Records intent in the DB. Idempotent. Returns a pending row so
                  it shows in history even if the chain step fails.

3. contract.contribute(onchain_group_id)
                  (SIGNATURE #2)
                  → contract pulls the exact contribution amount from your wallet
                    into its own balance. THIS IS THE DEPOSIT.

4. POST /api/groups/{id}/contributions/confirm
                  Flips the row pending → confirmed. Failure is swallowed — the
                  indexer will reconcile it anyway.
```

### 9.3 Inside the contract

`contribute` (`lib.rs:449-503`) enforces, in order:

1. `member.require_auth()` — the caller must actually be this member.
2. Group status must be `Active`.
3. Caller must be in the `Members` list → else `NotMember`.
4. Caller must not be defaulted → else `NotMember`.
5. Must not have already paid this cycle → else `AlreadyContributed` (#8).
6. **`token.transfer(member → contract, amount)`** — the escrow.
7. Mark paid, add to `Pool`, add to `PaidTotal` (used for exact refunds later).
8. Emit a `contrib` event.

Note the comment at `lib.rs:447-448`: *"Binds identity to authority: the signer
must already be a member of THIS group."* You cannot pay into a circle you're not
in, and you cannot pay on someone else's behalf.

### 9.4 Error handling

Every plausible failure is translated
([circle/page.tsx:157-183](src/app/(webapp)/groups/[groupId]/circle/page.tsx#L157-L183)):

| Cause | Toast |
|---|---|
| Missing trustline | "Your wallet can't hold USDC yet — approve the trustline when prompted, then try again." |
| `#8 AlreadyContributed` | Shown as **success**: "You've already contributed this cycle." |
| Rejected signature | "You cancelled the signature." |
| Insufficient funds | "Not enough USDC in your wallet to contribute." |

`AlreadyContributed` being a success toast is the right call — the user's goal
(be paid up) is achieved, so an error would be misleading.

### 9.5 Instant feedback

After a successful contribution the page:
1. Calls `refreshLive()` — reads the chain **directly** so the button flips to
   "You've paid this cycle" immediately, no waiting on the backend.
2. Calls `refetch()` for DB-derived data.
3. Schedules a second `refetch()` after 6 seconds to pick up the indexer's work
   (activity feed entries).

---

## 10. Flow 7 — The payout

This is the step with no button. **Nobody in the app triggers a payout.**

### 10.1 What triggers it

The backend's [ChainIndexer](backend/app/Services/Stellar/ChainIndexer.php) runs
every 30 seconds. For each active group it reads on-chain state, and when it finds
that every active member has contributed the current cycle
([ChainIndexer.php:198-212](backend/app/Services/Stellar/ChainIndexer.php#L198-L212)):

```php
if ($onchainStatus === 'active' && $allPaid) {
    $this->stellar->triggerPayout($onchainId);
}
```

This is safe because `trigger_payout` is **permissionless by design** — the
contract comment at `lib.rs:505-506` explains it: *"Callable by anyone (e.g. the
backend scheduler) since it can only ever pay the rules-determined recipient."*
Nobody can redirect or accelerate a payout by calling it.

> **This is why reconciliation matters.** If the indexer never runs
> isn't running, nothing calls `trigger_payout`, and the circle silently stalls
> with everyone paid up and no payout.

### 10.2 What the contract does

`trigger_payout` (`lib.rs:523-621`):

1. **Completeness check** — every *active* (non-defaulted) member must have paid
   this cycle, else `NotAllContributed`. Defaulted members are skipped, so one
   dropout can't freeze the circle.
2. **Pick the recipient** — the first member in rotation order who is active and
   hasn't yet received. Note this is deliberately *not* indexed by the raw cycle
   number, so removing a member never mis-assigns or double-pays a slot
   (invariant #4, `lib.rs:549-551`).
3. **Compute the split:**
   ```
   service_fee = pool × fee_bps / 10000
   late_fee    = min(recipient's accrued late-fee debt, pool − service_fee)
   fee         = service_fee + late_fee        → transferred to the ORGANIZER now
   net         = pool − fee                    → recorded as CLAIMABLE, stays escrowed
   ```
   The late fee is capped so a payout can never go negative.
4. **Only the fee leaves the contract.** The net is written to
   `Claimable(group_id, recipient)`, *added* to any existing balance so an
   unclaimed earlier payout is never lost.
5. Zero the pool, mark the recipient as `Received`, clear their settled late-fee
   debt, emit a `payout` event.
6. Advance the cycle counter, re-anchor the grace clock.
7. If no active member is still waiting to be paid → status becomes `Completed`.

### 10.3 What the recipient sees

The indexer's `reconcilePayouts()` reads each member's on-chain claimable and,
when it exceeds what's already recorded, writes a `Payout` row and a
`type=payout` Transaction. So the recipient gets:

- A new entry in **Activity** and **Wallet History**.
- Their **Saji Balance** on `/wallet` goes up by the net amount.
- The **Withdraw** CTA becomes available.

The money is theirs. It is still in the contract. §11 is how it gets out.

---

## 11. Flow 8 — Withdrawing

**Page:** `/wallet/withdraw` — [page.tsx](src/app/(webapp)/wallet/withdraw/page.tsx)

### 11.1 What "Saji Balance" means

Your withdrawable total is **two different kinds of money** added together
([useSajiBalance.ts:21-36](src/lib/hooks/useSajiBalance.ts#L21-L36)):

| Component | Where it is | To move it |
|---|---|---|
| `claimable_total` | Escrowed in the contract | One wallet signature **per circle** |
| `wallet_total` | Already in your wallet | A normal payment |
| `total` | Sum | — |

The split is kept explicit because the two behave differently — one costs a
signature per circle, the other is subject to the XLM account reserve. Summing
them into one opaque number would hide both facts.

Critically, `wallet_total` is **not your raw wallet balance**. It's bounded by
`min(owed, spendable)` where `owed` comes from `GET /api/wallet/payout-summary` —
what Saji has paid you minus what you've already withdrawn
([useSajiBalance.ts:134-140](src/lib/hooks/useSajiBalance.ts#L134-L140)). Without
that bound, Saji would be offering to send funds you put in your own wallet
yourself. It exists so that a claim that succeeded while its onward transfer
failed doesn't leave money invisible.

### 11.2 Why this is read in the browser

There is a backend endpoint (`GET /api/wallet/saji-balance`) that does the same
job, and the frontend **deliberately does not use it**. From
[useSajiBalance.ts:50-59](src/lib/hooks/useSajiBalance.ts#L50-L59):

> *"The backend's own `/wallet/saji-balance` does the same job but its RPC reads
> fail from the artisan-serve worker (the DNS wall) and silently return 0, so it
> reports an empty balance for a user who actually has a payout waiting. The
> browser reaches the RPC fine, so this takes the DB circle list from
> `/wallet/my-circles` and does the chain reads itself. **Do not "simplify" this
> back onto sajiBalance().**"*

So the hook: gets the circle list from the DB (no RPC), then calls
`contract.claimable_of()` per circle from the browser, then reads wallet balances
from Horizon. Same for the withdraw page's spendable check.

### 11.3 The withdraw screen

| Element | Behaviour |
|---|---|
| **Asset tabs** | One per asset with a balance (XLM / USDC / USDT). Shown even for a single asset so the number is never ambiguous. |
| **Amount input** | Large, with the asset code as a prefix. Border turns red if over balance. |
| **Available** | `claimable + wallet` for the selected asset |
| **Quick chips** | 25% / 50% / 75% / **Max** — *fractions*, not fixed denominations, because a payout is an arbitrary amount and a fixed ₦15,000 chip would usually be dead |
| **Destination Account** | Saved addresses as selectable cards; defaults to primary. **+ Add New** opens a modal |
| **Fees** | Network fee ≈ 0.00001 XLM. Explicitly *no* Saji processing fee or VAT |
| **Upcoming Contribution** | Dismissible purple note warning not to withdraw money you still owe a circle |

Adding a destination validates the address against `/^G[A-Z2-7]{55}$/` client-side
before `POST /api/withdraw-info`. The first one saved is automatically primary.

### 11.4 What "Confirm Withdrawal" actually does

This is the most intricate logic in the app
([withdraw/page.tsx:128-246](src/app/(webapp)/wallet/withdraw/page.tsx#L128-L246)),
because of one constraint: **`claim_payout` releases a circle's payout in full —
it takes no amount parameter.** You cannot partially claim.

So there are two paths:

**Path A — full withdrawal (one signature, no hop)**

When you're withdrawing your entire balance and none of it is already in your
wallet, the contract can pay the destination **directly**:

```
claim_payout(group_id, member, to = destination)
```

The escrowed net moves from the contract straight to the destination. The money
never touches your own wallet. One signature per circle, nothing else.

**Path B — partial withdrawal (claim home, then forward)**

For a partial amount, claiming direct would overshoot. So:

```
1. claim_payout(group_id, member, to = your own wallet)   ← per circle, largest first
2. spendableBalance(you, asset)                           ← what you can actually send
3. withdrawToken({ from: you, to: destination, amount })  ← one payment
4. POST /api/wallet/withdraw/log { tx_hash, amount, asset_code }
```

Circles are claimed **largest first** to minimise the number of signatures.
The send amount is clamped to `min(requested, spendable)` because for XLM the
account must keep its base reserve.

Before either path, if the asset is USDC/USDT the app checks the **destination**
has a trustline and fails early with a clear message if not — you cannot create a
trustline on an account you don't control.

### 11.5 The result screens

**Processing** — spinner, "Approve the transaction(s) when prompted."

**Completed** — green check, "X USDC is on its way to your destination." Plus two
conditional footnotes that exist because of the mechanics above:

- If less was sent than requested: *"Slightly less than you asked for — your
  account has to keep a small XLM reserve on-chain."*
- If a claim released more than was sent (Path B): *"The other N USDC was
  released into your wallet and is still in your Saji Balance — withdraw it
  anytime, no extra approval needed."* Without this, the user's Saji Balance
  would appear to move for no reason.

**Failed** — red warning with a specific message and a "Try again" link that
returns to the form with values intact. Horizon result codes are translated by
[describeSubmitError()](src/lib/wallet/index.ts#L130-L169), which digs the real
cause out of `response.data.extras.result_codes` — the SDK's own message is just
"400 Bad Request", which is useless. Mapped cases: `op_underfunded`, `op_no_trust`,
`op_no_destination`, `tx_insufficient_fee`, `tx_bad_seq`, `tx_too_late`,
`op_line_full`, with a raw-code fallback so nothing is ever opaque.

### 11.6 Withdrawing to your own wallet is fine

There's no "you can't send to yourself" block, and that's intentional
([withdraw/page.tsx:113-115](src/app/(webapp)/wallet/withdraw/page.tsx#L113-L115)):
your earnings live in the contract, not your wallet, so "withdraw to my wallet"
simply means "claim my earnings home."

---

## 12. Flow 9 — Defaults and late payments

When a member doesn't pay and the grace period elapses, the organizer sees a
**Resolve default** button on that member's row.

```
contract.resolve_default(group_id, memberAddress)    ← organizer signs
```

### The contract decides the outcome, not the app

`resolve_default` (`lib.rs:690-756`) validates:

1. Organizer signature required.
2. Group must be `Active`.
3. Member must exist and not already be defaulted.
4. Member must **not** have paid this cycle.
5. `now >= cycle_start + cycle_length + grace_period` — else `NotDefaultable` (#14).

Then it branches:

```
balance = token.balance(member)

if balance < contribution_amount   ← empty/insufficient wallet
   OR late_penalty == RemoveMember:
       → REMOVE: mark defaulted, skip in all future cycles and in the
                 rotation, and REFUND everything they had paid in
                 (tracked via PaidTotal)

else:  ← late_penalty == DeductFromBalance
       → ACCRUE a late fee (amount × late_fee_bps / 10000) as DEBT,
         netted out of their eventual payout and sent to the organizer
```

An empty wallet **always removes**, regardless of the group's chosen policy. They
can't pay, so keeping them would freeze the circle.

The UI reflects this honestly — it doesn't claim to know which happened:

> *"Resolved on-chain. If their wallet was empty they were removed and refunded;
> otherwise a late fee was applied."*

And `#14 NotDefaultable` becomes: *"Not resolvable yet — the member has paid, is
already out, or the grace period hasn't elapsed."*

After removal, that member is greyed out and struck through in the Payout Rotation
strip with the caption "Removed". `trigger_payout` skips them for completeness
checks and never assigns them a payout slot, so the circle continues with a
smaller rotation.

---

## 13. Flow 10 — Completion

When `trigger_payout` finds no active member still waiting to be paid, it sets
status to `Completed` and emits `grp_done` (`lib.rs:612-617`).

On the circle page, `isCompleted` flips (live status 3) and:
- The "This cycle" panel disappears.
- A **View Cycle Summary** button appears → `/groups/{id}/complete`.

That page ([complete/page.tsx](src/app/(webapp)/groups/[groupId]/complete/page.tsx))
is the celebration/summary screen for a finished rotation.

Anyone with an unclaimed payout can still claim it — the claimable balance persists
after completion.

---

## 14. Supporting screens

### 14.1 Overview — `/overview`

The home dashboard, backed by `GET /api/dashboard`:

| Section | Component |
|---|---|
| Savings summary | [SavingsSummaryCard](src/features/overview/SavingsSummaryCard.tsx) |
| My circles | [MyCircles](src/features/overview/MyCircles.tsx) / [MyActiveGroups](src/features/overview/MyActiveGroups.tsx) |
| Payout rotation | [PayoutRotation](src/features/overview/PayoutRotation.tsx) |
| Recent activity | [RecentActivities](src/features/overview/RecentActivities.tsx) |
| Discover challenges | [DiscoverChallenges](src/features/overview/DiscoverChallenges.tsx) |
| Explore communities | [ExploreCommunities](src/features/overview/ExploreCommunities.tsx) |

The response includes `quick_deposit` — the soonest-due contribution — which drives
the "Upcoming Contribution" nudges on both the wallet and withdraw pages.

New users with no circles get [NoGroupPreview](src/features/group/NoGroupPreview.tsx).

### 14.2 Groups — `/groups`

`GET /api/groups` → [GroupList](src/features/group/GroupList.tsx) of
[MyCircleCard](src/features/group/MyCircleCard.tsx)s, plus the floating
[CreateGroupFloatBtn](src/features/group/CreateGroupFloatBtn.tsx).

### 14.3 Activity — `/activity`

`GET /api/activity?filter=all|contributions|payout|withdrawal`, paginated. Each row
links to `/transactions/{id}` for the detail view (type, status, amount, group,
transaction number, block-explorer link, timestamp).

### 14.4 Challenges (public savings)

A **different product** from rotating circles, sharing the `groups` table via
`circle_kind = 'challenge'`. A challenge is a *personal savings vault with a
social wrapper*: each member saves their own money toward a target the creator
set, and may withdraw any part of it at any time.

| | Rotating circle | Public challenge |
|---|---|---|
| Money | Pooled, rotates between members | **Only ever yours** |
| Joining | Invite link + approval | Open, instant |
| Structure | Take turns receiving the pool | Save toward your own target |
| Payout | Rotation | **None — you withdraw your own** |
| Withdrawal | Only after your turn | **Any amount, any time** |
| Penalties | Late fees, removal | None |
| Leaving | Locked in | Free anytime |

**The target is per-member and motivational.** The creator sets one number (say
500); every member is individually trying to reach it. `myProgress` measures
*your* saves against the full target, and `summary` counts
`members_reached_target` as members who each hit it. The contract never reads the
target — there is no lock, no deadline enforcement, and no forfeiture.

**Endpoints:** `GET /api/challenges` (browse) · `POST /api/challenges` (create) ·
`POST /api/challenges/{id}/join` · `/leave` · `/deposit` · `/progress` ·
`/summary` (leaderboard, omitted when `hide_balances` is set).

#### The challenge contract

Challenges get their **own Soroban contract**
([contract/contracts/challenge/](contract/contracts/challenge/src/lib.rs)),
separate from `savings`. Three functions:

| Function | Who signs | Effect |
|---|---|---|
| `deposit` | Member | Pulls tokens into escrow, credited to their balance |
| `withdraw` | Member | Releases any amount to any address they name |
| `balance_of` / `token_of` | — | Read-only |

**Why separate.** A contract has exactly one token balance however many storage
keys it keeps. In `savings`, every circle's escrow shares that balance — which is
what its `InsufficientEscrow` guard exists to catch. Challenge withdrawal is
*unconditional* (any member, any amount, any time), whereas circle escrow only
moves when a full cycle completes. Hosting the permissive path in the same
contract would point it at the pot holding everyone's rotating savings. A
separate address means a separate balance: a bug here can at worst drain
challenge deposits and cannot reach circle escrow at all — a guarantee from the
platform rather than from the code being correct.

**Balances are read from chain, not the database.** `balance_of` *is* the money
rather than a record of it, so progress cannot disagree with reality. The
`challenge_deposits` table becomes a receipt log (history, activity feed) rather
than the source of truth.

Unlike `claim_payout`, `withdraw` takes an **amount** — so a partial withdrawal
is one signature with no claim-home-and-forward hop (contrast §11.4).

#### Status — partially built

| Piece | State |
|---|---|
| Contract + 18 tests | **Done**, passing |
| Testnet deploy | **Done** — `CCOVZRUF5SOFVF26G4PKTESVTOXJ3IB6LAVHLEZTSBS3E6OEDHR7Q5JD` |
| TypeScript bindings + `useChallengeContract` | **Done** |
| Deposit flow (sign a real contract call) | Not yet — currently posts a hash to the backend |
| Challenge balances in Saji Balance | Not yet |
| Withdraw across both contracts | Not yet |
| Challenge detail page | **Does not exist** |

The deployed contract was verified against live testnet with real USDC, not
only in unit tests: a 500 USDC deposit escrowed and emitted `save`; a 200
partial withdrawal settled and returned the correct 300 remainder; overdrawing
by 1 was rejected with `#2 InsufficientBalance`; and a withdrawal to an address
lacking a USDC trustline reverted **with the savings left intact** — the
documented safe-failure path. Contract bookkeeping matched tokens actually held
at every step.

Today the only challenge UI is browse-and-join: the
[DiscoverChallenges](src/features/overview/DiscoverChallenges.tsx) card strip on
`/overview` (labelled "Public Saving Groups") and the search page.
`challenges.store`, `.leave`, `.summary`, `.myProgress`, and `.deposit` exist in
the API client but are called from nowhere.

Two known gaps in the *existing* backend, both to be resolved by the contract
work above:

1. **Deposits never become `confirmed`.** Rows are written `pending`, and both
   progress endpoints only count `confirmed` — but nothing sets that status. The
   `ChainIndexer` has no challenge handling. `PublicChallengeTest` flips the row
   by hand with the comment *"as the indexer would"*. So recorded progress
   currently always reads **zero**. Reading `balance_of` from chain removes the
   need for this path rather than fixing it.
2. **The boundary tests assert challenges have no money actions** —
   `test_challenge_rejects_rotating_contribution_endpoint` (422) and
   `test_rotating_circle_rejects_challenge_deposit_endpoint` (404). These will
   need revising when the deposit flow becomes a real contract call.

### 14.5 Profile — `/profile` and sub-pages

| Route | Contents |
|---|---|
| `/profile` | Avatar, name, tag, email, linked wallet |
| `/profile/edit` | Name, tag name, date of birth, gender, address, avatar upload |
| `/profile/security` | Change password; 2FA on suspicious withdrawal; lock after N failed attempts |
| `/profile/withdraw-info` | Manage saved withdrawal destinations; set primary |

### 14.6 Search — `/search?q=`

Searches groups and public challenges.

### 14.7 Statements

`GET /api/transactions/statement?file_type=pdf|csv&start_date=&end_date=` streams a
binary via [downloadFile()](src/lib/api/index.ts#L164-L175), which attaches the
bearer token manually because it bypasses the JSON `request()` helper.

---

## 15. The full page map

```
/                                    Landing page

/auth/login                          Email + password, Google button
/auth/register                       Step 1 — email
/auth/register/verify-otp            Step 2 — 4-digit code
/auth/register/create-profile        Step 3 — name, tag, password
/auth/google/callback                OAuth landing, stores token

── everything below is behind AuthGuard ──

/overview                            Home dashboard
/groups                              My circles
/groups/create                       4-step creation wizard
/groups/join/[token]                 Invite landing page
/groups/[groupId]                    Forming view + organizer setup
                                     (auto-redirects to /circle once active)
/groups/[groupId]/circle             The live circle — contribute here
/groups/[groupId]/requests           Pending join requests
/groups/[groupId]/payout-order       Drag-and-drop rotation order
/groups/[groupId]/complete           Finished-rotation summary
/wallet                              Balance, wallet link, history
/wallet/withdraw                     Claim + send
/activity                            Activity feed
/transactions/[id]                   Transaction detail
/search                              Search groups + challenges
/profile                             Profile
/profile/edit                        Edit personal info
/profile/security                    Password + security settings
/profile/withdraw-info               Saved withdrawal destinations
```

Navigation is the bottom [Navbar](src/components/dashboard/Navbar.tsx) plus the
[Header](src/components/dashboard/Header.tsx), with
[GoBack](src/components/dashboard/GoBack.tsx) on detail pages.

---

## 16. How state stays in sync

Money lives on-chain; the app needs it fast and queryable. Three mechanisms
reconcile the two, and they overlap on purpose.

### 16.1 Optimistic DB writes

Before a chain action, the frontend records intent (`POST /contributions`) so the
event appears in history immediately as `pending`, even if the chain step later
fails. Afterwards it reports success (`POST /contributions/confirm`) to flip it to
`confirmed`. Both confirm calls are `.catch(() => {})` — failure is fine, because:

### 16.2 The ChainIndexer

[backend/app/Services/Stellar/ChainIndexer.php](backend/app/Services/Stellar/ChainIndexer.php),
run by `chain:index` every 30 seconds
([routes/console.php](backend/routes/console.php)). Per active group it:

1. Reads on-chain status → updates the DB group status.
2. Reads per-member contribution flags → confirms `pending` contribution rows.
3. **Calls `trigger_payout` when every active member has paid** (see §10.1).
4. Reads each member's `claimable_of` → writes `Payout` rows + `payout` activity
   Transactions for anything newly claimable.
5. Finalizes pending Transactions by checking their hashes.

It's idempotent and `withoutOverlapping`, so a slow run can't stack.

> **The indexer is not optional**, but it no longer needs a process babysat.
> It runs inline after every mutating request via `after()`, and once a day via
> Vercel Cron. What that means in practice: anything done **in the app**
> reconciles in about a second, while anything done **outside** it (a wallet
> contributing directly, a tab closed mid-flow) can stay `pending` — with the
> activity feed empty and **payouts not triggering** — until the next daily
> sweep. Force one with `curl /api/cron/chain-index` rather than waiting.

### 16.3 Direct browser reads (the freshest layer)

For anything where a 30-second lag would be visible, the frontend reads the chain
itself:

| Hook | Reads | Used by |
|---|---|---|
| [useLiveCircle](src/lib/hooks/useLiveCircle.ts) | status, cycle, paid-this-cycle, claimable | Circle page |
| [useSajiBalance](src/lib/hooks/useSajiBalance.ts) | `claimable_of` per circle + Horizon balances | Wallet, withdraw |
| `getOnchainState()` | members list + status | Organizer setup |
| `spendableBalance()` | Horizon balance minus reserve | Withdraw |

The circle page states the precedence explicitly
([circle/page.tsx:105-120](src/app/(webapp)/groups/[groupId]/circle/page.tsx#L105-L120)):
*"Prefer live chain truth where we have it, fall back to the DB payload."*

There *was* a second reason beyond speed: under `php artisan serve` the backend's
own RPC reads failed on a DNS restriction and silently returned 0. **That is gone**
— server-side reads now run in-process through `@stellar/stellar-sdk` and work
fine. The client-first split remains because of freshness, not breakage, which is
also why `/wallet/saji-balance` exists but is unused and `/wallet/my-circles` stays
DB-only with chain reads left to the client.

---

## 17. Running it locally

Three processes, all required:

```bash
pnpm dev                       # http://localhost:3000 — app AND API
```

That is the whole thing. The API is Next.js route handlers in `src/app/api`;
there is no second server and no scheduler process to start.

Reconciliation runs inline after each mutating request (via `after()`), plus a
daily Vercel Cron sweep as the safety net. To force a sweep locally:

```bash
curl -H "Authorization: Bearer $CRON_SECRET"   http://localhost:3000/api/cron/chain-index
```

Check `read_failures` in the response — it should be `0`. See `RUNBOOK.md` §1.

You also need a **Stellar wallet browser extension** (Freighter is the usual
choice) funded on **testnet** — with XLM for fees and reserve, plus the group's
asset with a trustline. `backend/scripts/fund-testnet.sh` (still usable; it is a
shell script that calls the `stellar` CLI, not PHP) mints the self-issued
testnet USDC/USDT that [tokens.ts](src/lib/contract/tokens.ts) points at.

### Environment

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_URL` | Leave **unset** — the API is same-origin. Set only if deployed separately. |
| `NEXT_PUBLIC_USDC_SAC` / `NEXT_PUBLIC_USDC_ISSUER` | USDC contract + issuer |
| `NEXT_PUBLIC_USDT_SAC` / `NEXT_PUBLIC_USDT_ISSUER` | USDT contract + issuer |
| `NEXT_PUBLIC_XLM_SAC` | Native XLM SAC |
| `NEXT_PUBLIC_SAVINGS_CONTRACT_ID` | Rotating-circle contract |
| `NEXT_PUBLIC_CHALLENGE_CONTRACT_ID` | Public-savings contract |
| `NEXT_PUBLIC_STELLAR_NETWORK` | `TESTNET` (default) or `PUBLIC` |

All of these are resolved in one place —
[src/lib/stellar-network.ts](src/lib/stellar-network.ts) — which **throws at
module load** if a required value is missing on mainnet rather than falling
back to a testnet default. A half-configured app (mainnet RPC, testnet contract)
fails by silently reading zero balances, which is far worse than failing loudly.

The network is **testnet**, set in two places that must agree:
[wallet/index.ts:24](src/lib/wallet/index.ts#L24) (`Networks.TESTNET`) and the
backend's `STELLAR_NETWORK`. The USDC/USDT issuers are keys the project controls on
testnet so they can be minted on demand — swap them for the real Circle-issued
addresses via env before mainnet.

---

## Appendix — Contract quick reference

There are **two contracts**, deliberately holding separate token balances so a
bug in one cannot reach the other's escrow (see §14.4).

### Challenges — `contract/contracts/challenge/src/lib.rs`

| Function | Who signs | Effect |
|---|---|---|
| `deposit` | Member | Pulls tokens into escrow, credits their balance |
| `withdraw` | Member | Releases any amount to any address; returns the remainder |
| `balance_of` / `token_of` | — | Read-only |

**Errors:** `1` InvalidAmount · `2` InsufficientBalance · `3` WrongToken ·
`4` InvalidDestination · `5` InsufficientEscrow

**Invariants:** balances are keyed per `(challenge_id, member)`; you can only
withdraw your own, and only what you hold; the contract's real balance always
covers the sum of recorded balances; a challenge is locked to its first token.

### Circles — `contract/contracts/savings/src/lib.rs`

| Function | Who signs | Effect |
|---|---|---|
| `create_group` | Organizer | Creates group, returns id. Status → Open |
| `join_group` | **Organizer** | Adds a member. Only while Open |
| `set_payout_order` | Organizer | Sets rotation. Locks at start |
| `start_cycle` | Organizer | Status → Active. Needs ≥ 2 members |
| `contribute` | Member | Pulls contribution into escrow |
| `trigger_payout` | **Anyone** | Earmarks pool for next recipient; pays fee to organizer |
| `claim_payout` | Member | Releases escrowed net to any chosen address |
| `resolve_default` | Organizer | Removes + refunds, or accrues a late fee |
| `get_group` / `get_members` / `get_pool` / `get_cycle` | — | Read-only |
| `claimable_of` / `is_removed` / `late_fee_of` / `has_contributed` | — | Read-only |

**Status codes:** `0` Draft · `1` Open · `2` Active · `3` Completed

**Error codes seen in the UI:** `#5` WrongStatus · `#6` AlreadyMember ·
`#8` AlreadyContributed · `#10` TooFewMembers · `#14` NotDefaultable

**Limits:** max fee 1,000 bps (10%) · max 100 members · amounts in stroops
(1 token = 10,000,000)

---

## Appendix — Signature count per action

Useful for setting user expectations, since each is a wallet popup.

| Action | Signatures |
|---|---|
| Connect wallet | 0 (approval in the wallet's own UI) |
| Create group | 1 (`create_group`) |
| Join via link | 0 |
| Organizer admits a member | 1 per member (`join_group`) |
| Set payout order | 1 |
| Start cycle | 1 |
| Contribute (first time, USDC/USDT) | 2 (trustline + contribute) |
| Contribute (thereafter) | 1 |
| Payout | 0 — the indexer triggers it |
| Withdraw, full amount, one circle | 1 (`claim_payout` direct to destination) |
| Withdraw, partial | 1 per circle claimed + 1 payment |
| Resolve a default | 1 |
