# Saji Savings Group — Soroban Contract Spec

Status: **draft for review** · Network: **Stellar Testnet** · Language: **Rust (soroban-sdk)**

This is the trustless core of Saji. It is the source of truth for money and
payout rotation. The Laravel backend orchestrates and mirrors this state; it is
never the authority on balances.

---

## 1. Design decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Deployment model | **One contract, many groups keyed by `group_id`** | No deploy per circle; single audit/upgrade surface. Funds isolated *by accounting*, enforced by invariants. |
| Custody / token flow | **Contract holds the pool (escrow); non-custodial signing** | `contribute` pulls USDC into the contract; `trigger_payout` pays from the contract. The backend never holds keys — every money action is **signed by the user's connected wallet**. |
| Wallet model | **Sign-in = identity; connect wallet = authority.** Users connect a wallet **at deposit time** (not stored on the profile). Wallet SDK (passkey vs Freighter) chosen at frontend integration — contract & backend stay wallet-agnostic. | Matches "sign in, but confirm actions with connect wallet." |
| Default asset | **USDC** as a Soroban token (SAC address passed per group) | Per the Saji sync call; contract is asset-agnostic — it stores whatever token address it's given. |
| Missed-contribution policy | **Strict** — payout reverts unless everyone paid | Matches how trust-based Ajo/Esusu work; simplest safe MVP. A documented hook is left for a future default-handling upgrade. |
| Cycle timing | **Per-group `cycle_length` set at creation; enforced off-chain.** | Contract stores it; the Laravel scheduler uses it to decide *when* to call `trigger_payout`. The on-chain rule is "everyone paid," not "time elapsed." |
| Fee | `fee_bps` (0–10000 = 0%–100%), deducted at payout, sent to organizer | Per sync call (organizer sets 0% or a service charge). |

---

## 2. State machine

```
Draft ──join_group (organizer approves)──► Open
Open ──start_cycle (locks rotation order)──► Active
Active ──contribute × all members──► (all paid)
       └── trigger_payout ──► Active (cycle+1)  ── … ── ► Completed (after full rotation)
```

- **Draft**: created; organizer is member #1; more members can be added.
- **Open**: still accepting members; no money yet.
- **Active**: a cycle is running; members contribute; payout when all have paid.
- **Completed**: every member has received exactly one payout.

---

## 3. Storage layout (all keys namespaced by `group_id`)

Persistent storage, keyed by an enum `DataKey`:

| Key | Value | Purpose |
|---|---|---|
| `GroupCount` | `u64` | Auto-increment source for new `group_id`s |
| `Config(group_id)` | `GroupConfig` | organizer, token, amount, cycle_len, fee_bps, status |
| `Members(group_id)` | `Vec<Address>` | Rotation order (index = payout position) |
| `Pool(group_id)` | `i128` | Current pooled balance held by the contract |
| `Cycle(group_id)` | `u32` | Current cycle index (0-based) |
| `Contributed(group_id, cycle, member)` | `bool` | Prevents double contribution per cycle |
| `Received(group_id, member)` | `bool` | Prevents a member receiving twice per rotation |

```rust
pub struct GroupConfig {
    pub organizer: Address,
    pub token: Address,          // USDC SAC address on Testnet
    pub amount: i128,            // contribution per member per cycle (7 decimals)
    pub cycle_length: u64,       // seconds; informational for scheduling
    pub fee_bps: u32,            // service charge, 0..=10000
    pub late_fee_bps: u32,       // penalty for late payers, 0..=10000 (stored; see §7)
    pub grace_period: u64,       // seconds a late payer has before defaulting (stored; see §7)
    pub payout_order: PayoutOrder, // Manual | Random | Vote | Custom (auditable policy)
    pub member_count: u32,
    pub status: Status,          // Draft | Open | Active | Completed
}
```

`late_fee_bps`, `grace_period` and `payout_order` back the Group Rules screen.
The strict-MVP rotation still pays the member at the current cycle's index in
the `Members` vec; `payout_order` records the organizer's chosen policy on-chain
so it is auditable and a future upgrade can enforce ordering. `late_fee_bps` /
`grace_period` are stored parameters for the documented default-handling hook
(§7) — not yet charged while the strict "everyone paid" rule holds.

---

## 4. Function surface

Signatures mirror the backend `StellarService` seam and the API stubs.

### Mutations

| Fn | Auth (`require_auth`) | Guards | Effect |
|---|---|---|---|
| `create_group(organizer, token, amount, cycle_length, fee_bps, late_fee_bps, grace_period, payout_order) -> u64` | `organizer` | `amount > 0`, `fee_bps <= 10000`, `late_fee_bps <= 10000` | New `group_id`; organizer = member #1; status `Draft`; stores rule fields. Returns id. |
| `join_group(group_id, member)` | `organizer` | status ∈ {Draft, Open}; member not present | Appends member to rotation. |
| `start_cycle(group_id)` | `organizer` | status ∈ {Draft, Open}; `member_count >= 2` | Locks order; status → Active; cycle = 0. |
| `contribute(group_id, member)` | `member` (connected wallet signs) | status == Active; **`member` is an approved, non-defaulted member of THIS group**; not already contributed this cycle | Transfers `amount` token from member → contract; marks contributed; `pool += amount`; tracks `PaidTotal` for refunds. Because the wallet is connected fresh at deposit time, the contract binds identity to authority here: the signing address must already be in the group's member list, so a user cannot deposit from an unregistered wallet. |
| `trigger_payout(group_id)` | anyone | status == Active; **all ACTIVE (non-defaulted)** members contributed this cycle | Pays recipient `pool - fee - late_fee`; `fee + late_fee` → organizer; marks `Received`; clears recipient's late-fee debt; advances cycle; → Completed when no active member is still awaiting a payout. |
| `resolve_default(group_id, member)` | `organizer` | status == Active; grace deadline (`cycle_length + grace_period` since cycle start) elapsed; member hasn't paid this cycle; not already defaulted | Empty/insufficient wallet **or** `RemoveMember` policy ⇒ mark defaulted, **refund** their `PaidTotal` from the pool, skip them thereafter. `DeductFromBalance` policy (with a solvent wallet) ⇒ accrue a late fee (`late_fee_bps` of `amount`) as debt, netted from their eventual payout. |

### Views (read-only, for the dashboard)

- `get_group(group_id) -> GroupConfig`
- `get_pool(group_id) -> i128`
- `get_cycle(group_id) -> u32`
- `get_members(group_id) -> Vec<Address>`
- `next_recipient(group_id) -> Address`
- `has_contributed(group_id, cycle, member) -> bool`

---

## 5. Invariants (what the tests must prove)

1. **Fund isolation**: tokens paid under `group_id = A` can never be moved by any call referencing `group_id = B`.
2. **One contribution per member per cycle**: a second `contribute` in the same cycle reverts.
3. **Payout completeness**: `trigger_payout` reverts unless every member has contributed the current cycle.
4. **Rotation fairness**: over a full rotation each member receives exactly one payout; `Received` blocks a second.
5. **Conservation**: `pool_after == pool_before + amount` on contribute; `pool == 0` immediately after each payout (whole pool disbursed).
6. **Fee bound**: `fee = pool * fee_bps / 10000`, `0 <= fee <= pool`; recipient gets `pool - fee`.
7. **Auth**: only `organizer` can `join_group`/`start_cycle`; only the member themselves can `contribute` for their address (their connected wallet signs).
8. **Wallet binding**: a `contribute` whose signing address is not already an approved member of that group reverts — connecting a different/unregistered wallet at deposit time cannot inject funds or membership.

---

## 6. Events (so the Laravel indexer can mirror state)

Emit on every state change; the backend polls Soroban RPC `getEvents` and writes rows.

| Event | Topics | Data |
|---|---|---|
| `group_created` | `("group_created", group_id)` | organizer, token, amount |
| `member_joined` | `("member_joined", group_id)` | member |
| `cycle_started` | `("cycle_started", group_id)` | member_count |
| `contributed` | `("contributed", group_id, member)` | cycle, amount |
| `paid_out` | `("paid_out", group_id)` | cycle, recipient, gross, fee, net |
| `group_completed` | `("group_completed", group_id)` | — |

---

## 7. Default handling (IMPLEMENTED) + remaining upgrade hooks

- **Default handling** — **shipped** via `resolve_default` (organizer-gated,
  deadline-based). Removes the H1 permanent-lock risk: a single non-payer can no
  longer freeze the pool. Rules:
  - *Empty wallet ⇒ removed.* If the defaulter's wallet can't cover `amount`,
    they are marked `Defaulted`, **refunded** everything they had paid in, and
    skipped for all future contributions and their own payout turn.
  - *Solvent but late (policy `DeductFromBalance`) ⇒ late fee.* A penalty of
    `late_fee_bps` of `amount` accrues as debt and is netted out of that
    member's eventual payout (paid to the organizer). Applied per unpaid cycle.
  - *Policy `RemoveMember` ⇒ removed + refunded* regardless of solvency.
  - The rotation vec is **never mutated**; defaulted members are flagged and
    skipped, so payout indices stay stable and no one is double-paid or skipped
    (invariant #4 preserved). Completion is now "no active member awaits a
    payout," not a raw count.
  - New storage: `Defaulted`, `PaidTotal`, `LateFees`, `CycleStart`. New views:
    `is_removed`, `late_fee_of`. New errors: `NotDefaultable (14)`,
    `TooManyMembers (15)`.
- **Multi-currency payout** (e.g. Cedis while USDC-dominant): out of scope; would need an FX/settlement design.
- **Contract upgradeability**: Soroban supports `update_current_contract_wasm`. Decide an admin/governance model before enabling.

---

## 8. Test plan (host tests, no live network)

Using `soroban-sdk` test utilities + a mock token (SAC):
1. create → join → start → full happy-path cycle → payout lands, fee correct.
2. Full rotation of N members → each paid once, status Completed.
3. Double contribute reverts (inv. 2).
4. Payout with a missing contributor reverts (inv. 3).
5. Two groups run in parallel; balances never cross (inv. 1).
6. Fee math at 0%, 1% (100 bps), 100% edge.
7. Auth failures: non-organizer join/start; wrong member contribute.
8. Wallet binding: a non-member address attempting `contribute` reverts (inv. 8).

---

## 9. Build / deploy commands (for reference)

```bash
# from contract/
stellar contract build                     # compiles to wasm
cargo test                                 # runs host tests
stellar contract deploy --network testnet  # deploy, prints contract id
```
