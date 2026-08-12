#![no_std]

//! Saji Savings Group — Soroban contract.
//!
//! One contract, many groups keyed by `group_id`. The contract escrows the
//! pooled token (USDC) and rotates payouts. Non-custodial: every money action
//! is authorized by the acting party's own wallet via `require_auth`. See
//! `SPEC.md` for the full design and invariants.

use soroban_sdk::{
    contract, contractimpl, contracterror, contracttype, panic_with_error,
    symbol_short, token, Address, Env, Vec,
};

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[contracttype]
pub enum Status {
    Draft = 0,
    Open = 1,
    Active = 2,
    Completed = 3,
}

/// How the payout rotation order is decided. The contract always pays the
/// member at `Cycle`'s index in the `Members` vec; this field records the
/// policy the organizer chose off-chain so it is auditable on-chain and so a
/// future upgrade can enforce ordering (e.g. a verifiable random shuffle).
/// How the payout rotation order is decided. The contract pays the member at
/// `Cycle`'s index in the `Members` vec; with `Manual` the organizer can set
/// that order explicitly via `set_payout_order` before the cycle starts.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[contracttype]
pub enum PayoutOrder {
    Manual = 0,
    Random = 1,
    Vote = 2,
    Custom = 3,
}

/// What happens to a member who misses a contribution past the grace period.
/// Both are now enforced by `resolve_default` (organizer-gated):
///   - `DeductFromBalance`: accrue a late fee (bps of `amount`) that is later
///     subtracted from the member's own payout and paid to the organizer.
///   - `RemoveMember`: mark the member defaulted — they are skipped for all
///     future contributions AND their own payout turn, and whatever they had
///     already paid into the pool is refunded to their wallet.
/// `resolve_default` also auto-removes ANY defaulter whose wallet can no longer
/// cover the contribution, regardless of this setting ("empty wallet ⇒ out").
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[contracttype]
pub enum LatePenalty {
    /// Deduct the late fee from what the defaulter is owed / their balance.
    DeductFromBalance = 0,
    /// Remove the defaulter from the circle if they cannot cover it.
    RemoveMember = 1,
}

#[derive(Clone)]
#[contracttype]
pub struct GroupConfig {
    pub organizer: Address,
    pub token: Address,
    pub amount: i128,
    pub cycle_length: u64,
    pub fee_bps: u32,
    /// Penalty a late payer owes, in bps of `amount`. Stored for the documented
    /// default-handling hook (SPEC §7); not yet charged in the strict MVP.
    pub late_fee_bps: u32,
    /// Seconds after a contribution's due time a member may still pay before
    /// counting as a default. Stored for the same future hook.
    pub grace_period: u64,
    /// Rotation-order policy chosen at creation (see `PayoutOrder`).
    pub payout_order: PayoutOrder,
    /// What happens on a missed contribution (see `LatePenalty`). Recorded now;
    /// enforced by the future default-handling upgrade.
    pub late_penalty: LatePenalty,
    pub member_count: u32,
    pub status: Status,
}

/// Storage keys — every group-scoped key carries the `group_id` so funds and
/// state for one group can never be addressed by another (invariant #1).
#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    GroupCount,
    Config(u64),
    Members(u64),
    Pool(u64),
    Cycle(u64),
    /// (group_id, cycle, member) -> has this member paid this cycle?
    Contributed(u64, u32, Address),
    /// (group_id, member) -> has this member already received a payout?
    Received(u64, Address),
    /// (group_id, member) -> has this member defaulted and been removed from the
    /// rotation? Defaulted members are skipped for contributions and payouts.
    Defaulted(u64, Address),
    /// (group_id, member) -> total token amount this member has paid into the
    /// pool across all cycles. Lifetime figure, for audit/UI only — it is NOT a
    /// refundable balance (see `Unrotated`).
    PaidTotal(u64, Address),
    /// (group_id, member) -> the part of this member's contributions that has
    /// NOT yet been rotated out to a recipient, i.e. the only money still
    /// sitting in the pool on their behalf.
    ///
    /// This is what a removal may refund. `PaidTotal` cannot be: once a cycle
    /// pays out, that pool went to someone else, so refunding against a lifetime
    /// total hands the defaulter money belonging to the members who funded the
    /// CURRENT cycle. Cleared for everyone on each payout, since a payout
    /// consumes the whole pool.
    Unrotated(u64, Address),
    /// (group_id, member) -> accrued late-fee debt (token stroops) deducted from
    /// this member's eventual payout and forwarded to the organizer.
    LateFees(u64, Address),
    /// (group_id, cycle, member) -> has a late fee already been charged to this
    /// member for this cycle? Caps accrual at once per cycle so the fee cannot be
    /// stacked by calling `resolve_default` repeatedly.
    LateFeeCharged(u64, u32, Address),
    /// (group_id) -> ledger timestamp when the current cycle became due for
    /// payout tracking. Set on start_cycle and each payout; resolve_default uses
    /// it with grace_period to decide whether a member is late.
    CycleStart(u64),
    /// (group_id, member) -> token amount this member is OWED and can claim.
    /// Payouts are pull-based: `trigger_payout` records the net here (funds stay
    /// escrowed in the contract, non-custodial) and the recipient signs
    /// `claim_payout` to withdraw it to their own wallet.
    Claimable(u64, Address),
}

#[contracterror]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u32)]
pub enum Error {
    GroupNotFound = 1,
    /// Reserved: organizer-gated actions revert via `require_auth()` today, but
    /// this typed variant is kept stable in the ABI for the future
    /// `resolve_default` hook (SPEC §7), which will check it explicitly.
    NotOrganizer = 2,
    InvalidFee = 3,
    InvalidAmount = 4,
    WrongStatus = 5,
    AlreadyMember = 6,
    NotMember = 7,
    AlreadyContributed = 8,
    NotAllContributed = 9,
    TooFewMembers = 10,
    InvalidCycleLength = 11,
    /// A proposed manual order isn't a valid permutation of the current members
    /// (wrong length, missing member, or a duplicate/stranger).
    InvalidOrder = 12,
    /// set_payout_order was called on a group whose order is Random/Vote/etc.,
    /// where an explicit manual order does not apply.
    OrderNotManual = 13,
    /// resolve_default was called on a member who is not (or no longer) eligible
    /// to be defaulted: not a member, already defaulted, or already paid this
    /// cycle, or the grace period has not yet elapsed.
    NotDefaultable = 14,
    /// The group has too many members for a single-transaction payout to stay
    /// within resource limits (see MAX_MEMBERS).
    TooManyMembers = 15,
    /// claim_payout was called by a member who has nothing owed to claim.
    NothingToClaim = 16,
    /// A transfer would exceed what the contract actually holds. Every group's
    /// funds share one token balance, so this catches per-group bookkeeping
    /// drifting above reality before it can spend another circle's escrow.
    InsufficientEscrow = 17,
    /// A contribution was attempted before this cycle's deposit window opened.
    /// The previous cycle paid out early, but the SCHEDULE still holds: the next
    /// round cannot start before `cycle_length` has elapsed.
    CycleNotOpen = 19,
    /// The current cycle's recipient tried to contribute. They are exempt — the
    /// pot they are about to receive is funded by everyone else.
    RecipientExempt = 20,
    /// claim_payout was given the contract's own address as the destination.
    /// That would clear the claim while the tokens never move, destroying the
    /// payout with no way to recover it.
    InvalidDestination = 18,
}

const BPS_DENOMINATOR: i128 = 10_000;

/// Upper bound on service `fee_bps` (L7): a 10% ceiling stops an organizer from
/// setting a confiscatory fee that drains the pool to themselves each cycle.
const MAX_FEE_BPS: u32 = 1_000;

/// Upper bound on members per group (L5): `trigger_payout`/`resolve_default`
/// iterate the member vec in one transaction, so an unbounded group could
/// exceed Soroban's resource budget and become un-payable.
const MAX_MEMBERS: u32 = 100;

/// Floor on `cycle_length`. `cycle_length != 0` alone permitted a one-second
/// cycle, under which every member is defaultable almost immediately — the
/// precondition for using `resolve_default` as a fee farm. One hour is short
/// enough to test against and long enough to be honest.
const MIN_CYCLE_LENGTH: u64 = 3_600;

/// Ceiling on `cycle_length`: 120 days.
///
/// NOT an arbitrary product choice — it is forced by state archival. A cycle's
/// `Contributed` receipts are written when each member pays and are read again
/// by `trigger_payout` when the cycle closes. If a receipt's TTL lapses in
/// between, the payout fails on footprint access and the pool is unspendable
/// until someone manually submits a RestoreFootprint — which nothing in this
/// project does. So a cycle MUST fit inside one lease.
///
/// The network caps `max_entry_ttl` at 3_110_400 ledgers (180 days at the 5s
/// target close time), so `TTL_EXTEND_TO` cannot exceed that and sits just
/// under it at 175 days. 120 days leaves ~55 days of margin for ledgers
/// closing faster than target — TTL is counted in LEDGERS while `cycle_length`
/// is wall-clock SECONDS, so the two can drift apart.
///
/// This was 365 days, which NO achievable lease can cover: any circle with a
/// cycle over ~6 months quietly bricked itself.
const MAX_CYCLE_LENGTH: u64 = 120 * 86_400;

/// How long the organizer gets EXCLUSIVE right to resolve a default before any
/// member may do it instead.
///
/// `resolve_default` used to be organizer-only forever. Every one of its
/// preconditions is objective and on-chain, and the contract — not the
/// organizer — decides remove-vs-fee, so the signature added no safety. What it
/// did add was a single point of failure: with one member silent, the
/// completeness check blocks `trigger_payout`, and if the organizer loses their
/// wallet or simply stops caring, EVERY other member's escrow is frozen with no
/// timeout, no vote and no sweep to recover it.
///
/// The window preserves the one thing the gate was actually good for —
/// discretion, e.g. giving a member with a genuine emergency a few more days —
/// and then lets the circle rescue itself.
const DEFAULT_ESCALATION_WINDOW: u64 = 7 * 86_400;


// Persistent-storage lifetime. Soroban archives persistent entries once their
// TTL lapses; an archived group would be unspendable. A savings circle can run
// for many cycles across weeks/months, so we extend the TTL of a group's live
// keys on every state change. (1 ledger ≈ 5s ⇒ 17_280 ledgers/day.)
const LEDGERS_PER_DAY: u32 = 17_280;

/// Bump a key once fewer than this many ledgers remain on its lease.
const TTL_THRESHOLD: u32 = 30 * LEDGERS_PER_DAY;

/// Extend to 175 days.
///
/// HARD CEILING: the network's `max_entry_ttl` is 3_110_400 ledgers — exactly
/// 180 days at the 5s target close time. `extend_ttl` beyond that is rejected
/// by the host, and because `bump_ttl` runs on EVERY state change, exceeding it
/// would make every call in this contract fail. Do not raise this past 180 days
/// without re-reading `max_entry_ttl` from the target network first:
///
///     stellar network settings --network <net>   # state_archival.max_entry_ttl
///
/// 175 leaves headroom under the cap. It was 90, which is shorter than the
/// cycle lengths the contract accepted — see `MAX_CYCLE_LENGTH`.
const TTL_EXTEND_TO: u32 = 175 * LEDGERS_PER_DAY;

/// The network's `state_archival.max_entry_ttl`, in ledgers. Mirrored here only
/// so the assertion below can check against it at COMPILE time.
const NETWORK_MAX_ENTRY_TTL: u32 = 3_110_400;

// ---- Compile-time guards on the two invariants above ----
//
// Both of these encode a way the contract can strand real money, and neither is
// visible at a glance from the constants. Breaking either now fails the BUILD
// rather than shipping and going wrong months later on a long-running circle.

// 1. A lease may never exceed the network ceiling. `bump_ttl` runs on every
//    state change, so an over-long `extend_ttl` is rejected by the host and
//    EVERY call in this contract fails — a total brick, not a degradation.
const _: () = assert!(
    TTL_EXTEND_TO <= NETWORK_MAX_ENTRY_TTL,
    "TTL_EXTEND_TO exceeds the network's max_entry_ttl; every call would fail",
);

// 2. A cycle must fit inside a single lease. `Contributed` receipts are written
//    when a member pays and read back by `trigger_payout` at the close of the
//    cycle; if one archives in between, the payout fails on footprint access
//    and the pool is unspendable with no restore path in this project.
const _: () = assert!(
    MAX_CYCLE_LENGTH < (TTL_EXTEND_TO as u64 / LEDGERS_PER_DAY as u64) * 86_400,
    "MAX_CYCLE_LENGTH outlives TTL_EXTEND_TO; long circles would strand their pool",
);

// ----------------------------------------------------------------------------
// Contract
// ----------------------------------------------------------------------------

#[contract]
pub struct SavingsContract;

#[contractimpl]
impl SavingsContract {
    /// Create a savings group. The organizer becomes member #1. Returns the
    /// new `group_id`. The organizer authorizes this call with their wallet.
    pub fn create_group(
        env: Env,
        organizer: Address,
        token: Address,
        amount: i128,
        cycle_length: u64,
        fee_bps: u32,
        late_fee_bps: u32,
        grace_period: u64,
        payout_order: PayoutOrder,
        late_penalty: LatePenalty,
    ) -> Result<u64, Error> {
        organizer.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if cycle_length == 0 {
            return Err(Error::InvalidCycleLength);
        }
        // BOTH fees are capped at MAX_FEE_BPS (10%).
        //
        // The late fee used to allow up to 100% of `amount`, which defeated the
        // service-fee cap entirely rather than complementing it: late fees accrue
        // once per cycle per late member, are bounded at payout only by the whole
        // pot, and are paid TO THE ORGANIZER. Over N cycles an organizer could
        // therefore capture a member's entire payout — exactly the confiscatory
        // outcome MAX_FEE_BPS exists to prevent, just reached by another route.
        if fee_bps > MAX_FEE_BPS || late_fee_bps > MAX_FEE_BPS {
            return Err(Error::InvalidFee);
        }
        // A one-second cycle makes every member defaultable almost immediately,
        // which is the precondition for using `resolve_default` as a fee farm.
        // `cycle_length != 0` alone did not prevent that.
        //
        // No floor on `grace_period`: with a sane cycle length, zero grace just
        // means "the cycle itself is your window to pay", which is a legitimate
        // choice rather than a hostile one.
        if cycle_length < MIN_CYCLE_LENGTH || cycle_length > MAX_CYCLE_LENGTH {
            return Err(Error::InvalidCycleLength);
        }

        let storage = env.storage().persistent();

        // Allocate the next group_id.
        let group_id: u64 = storage.get(&DataKey::GroupCount).unwrap_or(0);
        storage.set(&DataKey::GroupCount, &(group_id + 1));

        let config = GroupConfig {
            organizer: organizer.clone(),
            token,
            amount,
            cycle_length,
            fee_bps,
            late_fee_bps,
            grace_period,
            payout_order,
            late_penalty,
            member_count: 1,
            status: Status::Draft,
        };
        storage.set(&DataKey::Config(group_id), &config);

        // Organizer is the first member in the rotation.
        let mut members: Vec<Address> = Vec::new(&env);
        members.push_back(organizer.clone());
        storage.set(&DataKey::Members(group_id), &members);

        storage.set(&DataKey::Pool(group_id), &0i128);
        storage.set(&DataKey::Cycle(group_id), &0u32);

        env.events().publish(
            (symbol_short!("grp_new"), group_id),
            (organizer, amount),
        );

        Self::bump_ttl(&env, group_id);
        Ok(group_id)
    }

    /// Organizer admits a new member. Only allowed while the group is still
    /// forming (Draft/Open) so the rotation order is fixed before any money.
    pub fn join_group(env: Env, group_id: u64, member: Address) -> Result<(), Error> {
        let storage = env.storage().persistent();
        let mut config = Self::load_config(&env, group_id)?;

        config.organizer.require_auth();

        if config.status != Status::Draft && config.status != Status::Open {
            return Err(Error::WrongStatus);
        }

        let mut members: Vec<Address> = storage
            .get(&DataKey::Members(group_id))
            .ok_or(Error::GroupNotFound)?;

        if members.contains(&member) {
            return Err(Error::AlreadyMember);
        }
        if config.member_count >= MAX_MEMBERS {
            return Err(Error::TooManyMembers);
        }

        members.push_back(member.clone());
        config.member_count += 1;
        config.status = Status::Open;

        storage.set(&DataKey::Members(group_id), &members);
        storage.set(&DataKey::Config(group_id), &config);

        env.events()
            .publish((symbol_short!("joined"), group_id), member);

        Self::bump_ttl(&env, group_id);
        Ok(())
    }

    /// Organizer sets the exact payout rotation order (the drag-and-drop "who
    /// gets paid first" feature). Only valid while the group is still forming
    /// (Draft/Open) and only when the group's policy is `Manual`. The proposed
    /// `order` must be a permutation of the current members — same length, every
    /// current member present exactly once — so no one is dropped or injected.
    /// The order is frozen when `start_cycle` locks the group.
    pub fn set_payout_order(env: Env, group_id: u64, order: Vec<Address>) -> Result<(), Error> {
        let storage = env.storage().persistent();
        let config = Self::load_config(&env, group_id)?;

        config.organizer.require_auth();

        if config.status != Status::Draft && config.status != Status::Open {
            return Err(Error::WrongStatus);
        }
        if config.payout_order != PayoutOrder::Manual {
            return Err(Error::OrderNotManual);
        }

        let members: Vec<Address> = storage
            .get(&DataKey::Members(group_id))
            .ok_or(Error::GroupNotFound)?;

        // Same size, and every proposed entry is a current member (no strangers).
        if order.len() != members.len() {
            return Err(Error::InvalidOrder);
        }
        for addr in order.iter() {
            if !members.contains(&addr) {
                return Err(Error::InvalidOrder);
            }
        }
        // No duplicates: each current member appears exactly once in `order`.
        // (Combined with equal length + subset above, this proves a permutation.)
        for m in members.iter() {
            let mut seen = 0u32;
            for a in order.iter() {
                if a == m {
                    seen += 1;
                }
            }
            if seen != 1 {
                return Err(Error::InvalidOrder);
            }
        }

        storage.set(&DataKey::Members(group_id), &order);
        Self::bump_ttl(&env, group_id);

        env.events()
            .publish((symbol_short!("reorder"), group_id), ());

        Ok(())
    }

    /// Organizer starts the first cycle, locking the rotation order. Requires
    /// at least two members (a one-person circle is meaningless).
    pub fn start_cycle(env: Env, group_id: u64) -> Result<(), Error> {
        let storage = env.storage().persistent();
        let mut config = Self::load_config(&env, group_id)?;

        config.organizer.require_auth();

        if config.status != Status::Draft && config.status != Status::Open {
            return Err(Error::WrongStatus);
        }
        if config.member_count < 2 {
            return Err(Error::TooFewMembers);
        }

        config.status = Status::Active;
        storage.set(&DataKey::Config(group_id), &config);
        storage.set(&DataKey::Cycle(group_id), &0u32);
        // Anchor the grace clock for the first cycle.
        storage.set(&DataKey::CycleStart(group_id), &env.ledger().timestamp());

        env.events().publish(
            (symbol_short!("cyc_start"), group_id),
            config.member_count,
        );

        Self::bump_ttl(&env, group_id);
        Ok(())
    }

    /// One-shot launch: admit the full member roster in the chosen payout order
    /// AND start the first cycle, in a SINGLE organizer-signed transaction. This
    /// is the "Start Circle" action — instead of admitting each joiner on-chain
    /// (one signature each) then starting, the organizer accepts members in the
    /// app (off-chain) and launches everyone at once here.
    ///
    /// `order` is the complete rotation: every member (including the organizer)
    /// exactly once, in payout order (index = payout position). It replaces the
    /// member list wholesale, so it must:
    ///   - contain the organizer,
    ///   - have ≥ 2 entries and ≤ MAX_MEMBERS,
    ///   - have no duplicates.
    /// Valid only while the group is still forming (Draft/Open). After this the
    /// group is Active and the roster/order are locked.
    pub fn start_with_members(env: Env, group_id: u64, order: Vec<Address>) -> Result<(), Error> {
        let storage = env.storage().persistent();
        let mut config = Self::load_config(&env, group_id)?;

        config.organizer.require_auth();

        if config.status != Status::Draft && config.status != Status::Open {
            return Err(Error::WrongStatus);
        }
        if order.len() < 2 {
            return Err(Error::TooFewMembers);
        }
        if order.len() > MAX_MEMBERS {
            return Err(Error::TooManyMembers);
        }

        // The organizer must be part of the rotation they're launching.
        if !order.contains(&config.organizer) {
            return Err(Error::InvalidOrder);
        }

        // Same policy gate `set_payout_order` enforces. Without it this function
        // was a way around it: an organizer who advertised Random or Vote could
        // hand-pick the rotation here — including putting themselves first, the
        // most valuable slot in a ROSCA — in a single call.
        if config.payout_order != PayoutOrder::Manual {
            return Err(Error::OrderNotManual);
        }

        // No duplicates: each address appears exactly once. O(n²) but n is small
        // (capped at MAX_MEMBERS) and this runs once per group.
        for a in order.iter() {
            let mut seen = 0u32;
            for b in order.iter() {
                if a == b {
                    seen += 1;
                }
            }
            if seen != 1 {
                return Err(Error::InvalidOrder);
            }
        }

        // Roster + order become the member vec wholesale; count follows it.
        config.member_count = order.len();
        config.status = Status::Active;
        storage.set(&DataKey::Members(group_id), &order);
        storage.set(&DataKey::Config(group_id), &config);
        storage.set(&DataKey::Cycle(group_id), &0u32);
        storage.set(&DataKey::CycleStart(group_id), &env.ledger().timestamp());

        // One "joined" event per admitted member (skip the organizer, who joined
        // at creation) so the indexer can mirror membership.
        for m in order.iter() {
            if m != config.organizer {
                env.events()
                    .publish((symbol_short!("joined"), group_id), m.clone());
            }
        }
        env.events().publish(
            (symbol_short!("cyc_start"), group_id),
            config.member_count,
        );

        Self::bump_ttl(&env, group_id);
        Ok(())
    }

    /// A member contributes the fixed amount for the current cycle. The member
    /// authorizes with their connected wallet; the token is pulled into the
    /// contract's own balance (escrow). Binds identity to authority: the
    /// signer must already be a member of THIS group (invariant #8).
    pub fn contribute(env: Env, group_id: u64, member: Address) -> Result<(), Error> {
        member.require_auth();

        let storage = env.storage().persistent();
        let config = Self::load_config(&env, group_id)?;

        if config.status != Status::Active {
            return Err(Error::WrongStatus);
        }

        let members: Vec<Address> = storage
            .get(&DataKey::Members(group_id))
            .ok_or(Error::GroupNotFound)?;
        if !members.contains(&member) {
            return Err(Error::NotMember);
        }
        // A removed (defaulted) member is out of the rotation and cannot pay in.
        if Self::is_defaulted(&env, group_id, &member) {
            return Err(Error::NotMember);
        }

        // THE DEPOSIT WINDOW. A cycle pays out as soon as everyone who owes has
        // paid, which can be long before `cycle_length` elapses — the recipient
        // should not wait for money the group has already collected. The
        // SCHEDULE is preserved here instead: the next round's deposits do not
        // open until the cycle boundary, so a "monthly" circle still takes a
        // month per rotation however fast members are.
        let opens_at: u64 = storage
            .get(&DataKey::CycleStart(group_id))
            .ok_or(Error::WrongStatus)?;
        if env.ledger().timestamp() < opens_at {
            return Err(Error::CycleNotOpen);
        }

        // THE RECIPIENT IS EXEMPT. Whoever is due to collect this cycle does not
        // pay into their own pot: it is funded by the other active members. Over
        // a full rotation each member sits out exactly once, so everyone still
        // pays the same total and receives the same total — it just removes a
        // round-trip where the recipient paid `amount` in and immediately got it
        // back, costing a signature and a network fee every rotation.
        if Self::current_recipient(&env, group_id, &members) == Some(member.clone()) {
            return Err(Error::RecipientExempt);
        }

        let cycle: u32 = storage.get(&DataKey::Cycle(group_id)).unwrap_or(0);
        let paid_key = DataKey::Contributed(group_id, cycle, member.clone());
        if storage.get::<DataKey, bool>(&paid_key).unwrap_or(false) {
            return Err(Error::AlreadyContributed);
        }

        // ANY ACCRUED LATE FEE IS CHARGED ON THIS DEPOSIT.
        //
        // The penalty used to be netted out of the debtor's own eventual payout.
        // That could not reach the member who most needs it: someone who has
        // ALREADY received their turn has no future payout to net against, so
        // they could go quiet for the rest of the rotation at no on-chain cost.
        // Collecting at deposit time works for every member, and the money lands
        // in the pot of the cycle their lateness delayed — so the people who
        // waited are the ones compensated, not the organizer, who lost nothing.
        let owed: i128 = storage
            .get(&DataKey::LateFees(group_id, member.clone()))
            .unwrap_or(0);
        let due = config.amount + owed;

        // Effects BEFORE the external call (checks-effects-interactions): the
        // token is an arbitrary contract address, so its `transfer` is untrusted
        // code. Writing state first means a reentrant call sees this cycle as
        // already paid and is rejected by the guard above.
        storage.set(&paid_key, &true);
        let pool: i128 = storage.get(&DataKey::Pool(group_id)).unwrap_or(0);
        storage.set(&DataKey::Pool(group_id), &(pool + due));

        // The debt is settled — clear it before the transfer, so a reentrant
        // call cannot see it still outstanding and charge it twice.
        if owed > 0 {
            storage.remove(&DataKey::LateFees(group_id, member.clone()));
        }

        // Track lifetime contributions (audit/UI) and the portion not yet
        // rotated out, which is the only part a refund may draw on.
        //
        // Both count the CONTRIBUTION only, never the penalty: a forfeited late
        // fee is not refundable, so a member who is later removed must not get
        // it back out of the pool.
        let paid_total: i128 = storage
            .get(&DataKey::PaidTotal(group_id, member.clone()))
            .unwrap_or(0);
        storage.set(
            &DataKey::PaidTotal(group_id, member.clone()),
            &(paid_total + config.amount),
        );
        let unrotated: i128 = storage
            .get(&DataKey::Unrotated(group_id, member.clone()))
            .unwrap_or(0);
        storage.set(
            &DataKey::Unrotated(group_id, member.clone()),
            &(unrotated + config.amount),
        );

        // Pull funds from the member into the contract (escrow).
        let token_client = token::Client::new(&env, &config.token);
        token_client.transfer(&member, &env.current_contract_address(), &due);

        env.events().publish(
            (symbol_short!("contrib"), group_id, member.clone()),
            (cycle, config.amount, owed),
        );

        Self::bump_ttl(&env, group_id);
        Self::bump_member_ttl(&env, group_id, &member);
        Self::bump_contributed_ttl(&env, group_id, cycle, &member);
        Ok(())
    }

    /// Pay the current cycle's recipient. Callable by anyone (e.g. the backend
    /// scheduler) since it can only ever pay the rules-determined recipient.
    ///
    /// Strict-but-fair completeness: every member who is still ACTIVE (not
    /// defaulted) must have paid this cycle. Defaulted members are skipped — the
    /// organizer removes them via `resolve_default` first, which also refunds
    /// what they had paid, so their absence never blocks the circle.
    ///
    /// The recipient is the next member in rotation order who has NOT already
    /// received AND is NOT defaulted. Any late-fee debt they accrued is netted
    /// out of their payout and sent to the organizer.
    ///
    /// PULL-BASED: the recipient's net is NOT pushed to their wallet here.
    /// Instead it is recorded as a claimable balance (funds stay escrowed in the
    /// contract — non-custodial) and the recipient signs `claim_payout` to
    /// withdraw it. Only the service/late fee is transferred out immediately, to
    /// the organizer. This makes the Withdraw/Claim action the way a member
    /// receives their turn's money, while keeping custody in the contract.
    pub fn trigger_payout(env: Env, group_id: u64) -> Result<(), Error> {
        let storage = env.storage().persistent();
        let mut config = Self::load_config(&env, group_id)?;

        if config.status != Status::Active {
            return Err(Error::WrongStatus);
        }

        let members: Vec<Address> = storage
            .get(&DataKey::Members(group_id))
            .ok_or(Error::GroupNotFound)?;
        let cycle: u32 = storage.get(&DataKey::Cycle(group_id)).unwrap_or(0);

        let started: u64 = storage
            .get(&DataKey::CycleStart(group_id))
            .ok_or(Error::WrongStatus)?;

        // Recipient first: they are EXEMPT from this cycle's contributions, so
        // the completeness check below has to know who they are.
        let recipient =
            Self::current_recipient(&env, group_id, &members).ok_or(Error::WrongStatus)?;

        // Completeness over ACTIVE members only, MINUS the recipient. Defaulted
        // members are skipped (the organizer removes them via resolve_default).
        //
        // No time gate here: the pot belongs to the recipient the moment the
        // group has finished funding it, and making them wait for the cycle
        // boundary would just park settled money in escrow. The schedule is
        // enforced on the DEPOSIT side instead — see `contribute`.
        for m in members.iter() {
            if m == recipient {
                continue;
            }
            if Self::is_defaulted(&env, group_id, &m) {
                continue;
            }
            let paid = storage
                .get::<DataKey, bool>(&DataKey::Contributed(group_id, cycle, m.clone()))
                .unwrap_or(false);
            if !paid {
                return Err(Error::NotAllContributed);
            }
        }

        let pool: i128 = storage.get(&DataKey::Pool(group_id)).unwrap_or(0);

        // INTENTIONAL: `fee_bps` applies to the WHOLE pool, late fees included.
        //
        // Late fees are collected on the debtor's next deposit and land in this
        // pool (see `contribute`), so the organizer earns their percentage on
        // penalty money as well as on contributions. That is a deliberate
        // policy choice, not an oversight: the fee is a flat cut of whatever the
        // pot holds, which is the version that can be explained to a member in
        // one sentence.
        //
        // The alternative — netting late fees out of the basis so the whole
        // penalty reaches the delayed recipient — was considered and rejected.
        // If it is ever revisited, note the mild incentive it leaves behind: the
        // organizer both decides whether to charge a penalty (`resolve_default`,
        // theirs alone for DEFAULT_ESCALATION_WINDOW) and earns a slice of it.
        // That is bounded, not open-ended: `LateFeeCharged` caps accrual at once
        // per cycle and `late_fee_bps` is capped at MAX_FEE_BPS.
        let service_fee: i128 = pool * config.fee_bps as i128 / BPS_DENOMINATOR;
        // Late fees are NOT handled here. They are charged on the debtor's next
        // deposit (see `contribute`), which means the money is already sitting
        // in this pool — and it landed in the pot of the very cycle their
        // lateness delayed, so the members who waited are the ones compensated.
        //
        // Netting it out of their eventual payout, as this used to, could not
        // work: a member who has ALREADY received has no future payout to net
        // against, which is exactly the member the penalty needs to reach.
        let net: i128 = pool - service_fee;

        let token_client = token::Client::new(&env, &config.token);
        let contract_addr = env.current_contract_address();

        // Record the recipient's payout as claimable (added to any existing
        // balance so an unclaimed earlier payout is never lost).
        let prev_claim: i128 = storage
            .get(&DataKey::Claimable(group_id, recipient.clone()))
            .unwrap_or(0);
        storage.set(&DataKey::Claimable(group_id, recipient.clone()), &(prev_claim + net));

        // This payout consumes the whole pool, so nobody has unrotated money in
        // it any more. Clearing this is what stops a later removal from
        // refunding contributions that have already gone to a recipient.
        for m in members.iter() {
            storage.remove(&DataKey::Unrotated(group_id, m));
        }

        storage.set(&DataKey::Pool(group_id), &0i128);
        storage.set(&DataKey::Received(group_id, recipient.clone()), &true);

        let finished = Self::remaining_recipients(&env, group_id, &members) == 0;

        // Interaction last: only the service fee leaves the contract now. The
        // recipient's net stays escrowed until they claim it.
        if service_fee > 0 {
            Self::assert_covers(&env, &token_client, service_fee);
            token_client.transfer(&contract_addr, &config.organizer, &service_fee);
        }

        env.events().publish(
            (symbol_short!("payout"), group_id),
            (cycle, recipient, pool, service_fee, net),
        );

        // Advance the cycle counter and re-anchor the grace clock. Completion is
        // decided by whether any ACTIVE member is still waiting to be paid, not
        // by a raw count — so removals shrink the rotation correctly.
        storage.set(&DataKey::Cycle(group_id), &(cycle + 1));
        // The next round opens on the ORIGINAL cadence, not `now` — otherwise a
        // circle that settles early each time drifts steadily forward and a
        // "monthly" rotation finishes in far less than N months. Clamped to at
        // least `now` so a cycle that overran does not open its successor in the
        // past (which would make everyone instantly late).
        let now = env.ledger().timestamp();
        let scheduled = started.saturating_add(config.cycle_length);
        let next_open = if scheduled > now { scheduled } else { now };
        storage.set(&DataKey::CycleStart(group_id), &next_open);

        // `finished` was computed above (the late fee's destination depends on
        // it); reuse it rather than walking the member vec a second time.
        if finished {
            config.status = Status::Completed;
            storage.set(&DataKey::Config(group_id), &config);
            env.events()
                .publish((symbol_short!("grp_done"), group_id), ());
        }

        Self::bump_ttl(&env, group_id);
        // Keep every member's money keys alive — an archived `Claimable` would
        // strand the payout, and an archived `Received` would let the same
        // member be paid a second time.
        for m in members.iter() {
            Self::bump_member_ttl(&env, group_id, &m);
        }
        Ok(())
    }

    /// Claim a payout that a completed cycle earmarked for `member`, sending it
    /// to `to` — the "Withdraw" action for a circle payout.
    ///
    /// Non-custodial: the funds were held by the contract, never by Saji, and
    /// only move on the member's own signature. `member.require_auth()` means
    /// naming a destination is the member's choice alone — nobody else can
    /// redirect their payout. `to` is deliberately unrestricted so a member can
    /// withdraw straight to any wallet they choose; it may equal `member`.
    ///
    /// The claimable entry stays keyed on `member` (not `to`), so a claim to a
    /// third party still clears the right balance and can't be replayed.
    ///
    /// The one destination that is rejected is the contract itself: that would
    /// clear the claim while the tokens never moved, destroying the payout.
    ///
    /// Note: if `to` holds no trustline for the group's token the transfer
    /// panics and the whole claim reverts — the payout stays escrowed and
    /// claimable, so nothing is lost. Callers should check first.
    ///
    /// Returns the claimed amount (stroops).
    pub fn claim_payout(
        env: Env,
        group_id: u64,
        member: Address,
        to: Address,
    ) -> Result<i128, Error> {
        member.require_auth();

        if to == env.current_contract_address() {
            return Err(Error::InvalidDestination);
        }

        let config = Self::load_config(&env, group_id)?;
        let storage = env.storage().persistent();

        let amount: i128 = storage
            .get(&DataKey::Claimable(group_id, member.clone()))
            .unwrap_or(0);
        if amount <= 0 {
            return Err(Error::NothingToClaim);
        }

        // Effects before interaction: clear the claim FIRST so a reentrant call
        // through an untrusted token contract finds nothing left to claim.
        storage.remove(&DataKey::Claimable(group_id, member.clone()));

        let token_client = token::Client::new(&env, &config.token);
        Self::assert_covers(&env, &token_client, amount);
        token_client.transfer(&env.current_contract_address(), &to, &amount);

        // `to` is published so the indexer can see where the funds actually went.
        env.events().publish(
            (symbol_short!("claimed"), group_id, member, to),
            amount,
        );

        Self::bump_ttl(&env, group_id);
        Ok(amount)
    }

    /// Organizer resolves a member who has missed the current cycle past the
    /// grace period. Enforces the two-part rule from the product design:
    ///
    ///   * If the member's wallet can no longer cover the contribution (empty
    ///     wallet), they are REMOVED regardless of the group's penalty policy —
    ///     marked defaulted, skipped in all future cycles and their own payout
    ///     turn, and everything they had already paid in is REFUNDED to them.
    ///   * Otherwise, apply the group's `late_penalty`:
    ///       - `RemoveMember`   → remove + refund (as above).
    ///       - `DeductFromBalance` → accrue a late fee (bps of `amount`) that is
    ///         later netted out of the member's own payout to the organizer.
    ///
    /// Organizer-gated. Only valid while Active, only when the grace period
    /// (`cycle_length + grace_period` seconds since the cycle's start) has
    /// elapsed and the member has NOT paid this cycle.
    pub fn resolve_default(env: Env, group_id: u64, member: Address) -> Result<(), Error> {
        let storage = env.storage().persistent();
        let config = Self::load_config(&env, group_id)?;

        // NOTE: authorization is deliberately NOT taken here. Who may call this
        // depends on how overdue the member is — see the escalation check below.

        if config.status != Status::Active {
            return Err(Error::WrongStatus);
        }

        let members: Vec<Address> = storage
            .get(&DataKey::Members(group_id))
            .ok_or(Error::GroupNotFound)?;
        if !members.contains(&member) {
            return Err(Error::NotMember);
        }
        // Can't re-default someone already out.
        if Self::is_defaulted(&env, group_id, &member) {
            return Err(Error::NotDefaultable);
        }

        let cycle: u32 = storage.get(&DataKey::Cycle(group_id)).unwrap_or(0);
        // Only a member who has NOT paid this cycle can be in default.
        let paid = storage
            .get::<DataKey, bool>(&DataKey::Contributed(group_id, cycle, member.clone()))
            .unwrap_or(false);
        if paid {
            return Err(Error::NotDefaultable);
        }

        // Grace clock: the member is only late once cycle_length + grace_period
        // seconds have passed since this cycle started.
        // `.unwrap_or(0)` here made the deadline `cycle_length + grace` measured
        // from the epoch — i.e. always in the past — so any group whose CycleStart
        // key was absent or archived became INSTANTLY defaultable. A missing
        // anchor means we cannot know if the member is late, so refuse.
        let started: u64 = storage
            .get(&DataKey::CycleStart(group_id))
            .ok_or(Error::NotDefaultable)?;
        let deadline = started
            .saturating_add(config.cycle_length)
            .saturating_add(config.grace_period);
        let now = env.ledger().timestamp();

        // Before the deadline nobody may act — the member is not yet late.
        if now < deadline {
            return Err(Error::NotDefaultable);
        }

        // From the deadline until the escalation window closes, this is the
        // organizer's call alone, so they can extend mercy the contract can't
        // express. After that ANY caller may resolve it: the preconditions above
        // are all objective and on-chain, and the outcome below is chosen by
        // this contract rather than by whoever calls. Leaving it organizer-only
        // forever is what let one absent organizer freeze everyone else's money.
        if now < deadline.saturating_add(DEFAULT_ESCALATION_WINDOW) {
            config.organizer.require_auth();
        }

        // Decide remove vs. late-fee. Empty/insufficient wallet always removes.
        let token_client = token::Client::new(&env, &config.token);
        let balance = token_client.balance(&member);
        let cannot_cover = balance < config.amount;

        if cannot_cover || config.late_penalty == LatePenalty::RemoveMember {
            Self::remove_member(&env, group_id, &member, &config, &token_client);
        } else {
            // Accrue a late fee (bps of the contribution amount) as debt — at
            // most ONCE per cycle. Without this key, every gate above stays true
            // after accrual, so an organizer could call this in a loop to run the
            // debt past the member's whole payout and redirect it to themselves,
            // bypassing the MAX_FEE_BPS cap entirely.
            let charged_key = DataKey::LateFeeCharged(group_id, cycle, member.clone());
            if storage.get::<DataKey, bool>(&charged_key).unwrap_or(false) {
                return Err(Error::NotDefaultable);
            }
            storage.set(&charged_key, &true);

            let late = config.amount * config.late_fee_bps as i128 / BPS_DENOMINATOR;
            let prev: i128 = storage
                .get(&DataKey::LateFees(group_id, member.clone()))
                .unwrap_or(0);
            storage.set(&DataKey::LateFees(group_id, member.clone()), &(prev + late));
            env.events().publish(
                (symbol_short!("late_fee"), group_id, member.clone()),
                (cycle, late),
            );
        }

        Self::bump_ttl(&env, group_id);
        Ok(())
    }

    // ---- Read-only views (for the dashboard / indexer) ----

    pub fn get_group(env: Env, group_id: u64) -> Result<GroupConfig, Error> {
        Self::load_config(&env, group_id)
    }

    pub fn get_pool(env: Env, group_id: u64) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Pool(group_id))
            .unwrap_or(0)
    }

    pub fn get_cycle(env: Env, group_id: u64) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::Cycle(group_id))
            .unwrap_or(0)
    }

    pub fn get_members(env: Env, group_id: u64) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::Members(group_id))
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// The address that will receive the current cycle's payout: the first
    /// member in rotation order who is active (not defaulted) and has not yet
    /// received. Mirrors the selection in `trigger_payout`.
    pub fn next_recipient(env: Env, group_id: u64) -> Result<Address, Error> {
        let members: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Members(group_id))
            .ok_or(Error::GroupNotFound)?;
        // Same scan `contribute` and `trigger_payout` use, so the address shown
        // in the UI is always the one the contract will actually pay and exempt.
        Self::current_recipient(&env, group_id, &members).ok_or(Error::GroupNotFound)
    }

    /// What `member` must actually send to contribute: the fixed amount plus any
    /// late fee they have accrued. The UI needs this so the confirmation screen
    /// matches what the wallet will be asked to transfer.
    pub fn amount_due(env: Env, group_id: u64, member: Address) -> Result<i128, Error> {
        let config = Self::load_config(&env, group_id)?;
        let owed: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::LateFees(group_id, member))
            .unwrap_or(0);
        Ok(config.amount + owed)
    }

    /// Ledger timestamp at which THIS cycle's deposits opened (or will open).
    ///
    /// A cycle can settle well before its length elapses, so the next round's
    /// deposit window is what carries the schedule. The UI needs this to show
    /// "next contribution opens in ..." rather than letting a member sign a
    /// transaction that reverts with `CycleNotOpen`.
    pub fn deposits_open_at(env: Env, group_id: u64) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::CycleStart(group_id))
            .unwrap_or(0)
    }

    pub fn has_contributed(env: Env, group_id: u64, cycle: u32, member: Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Contributed(group_id, cycle, member))
            .unwrap_or(false)
    }

    /// Whether a member has been removed from the rotation (defaulted).
    pub fn is_removed(env: Env, group_id: u64, member: Address) -> bool {
        Self::is_defaulted(&env, group_id, &member)
    }

    /// Accrued late-fee debt (token stroops) that will be netted out of the
    /// member's eventual payout.
    pub fn late_fee_of(env: Env, group_id: u64, member: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::LateFees(group_id, member))
            .unwrap_or(0)
    }

    /// Amount (token stroops) this member is owed and can `claim_payout`. 0 means
    /// nothing to claim. The Withdraw screen reads this to show a claim button.
    pub fn claimable_of(env: Env, group_id: u64, member: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Claimable(group_id, member))
            .unwrap_or(0)
    }

    // ---- internal ----

    fn load_config(env: &Env, group_id: u64) -> Result<GroupConfig, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Config(group_id))
            .ok_or(Error::GroupNotFound)
    }

    /// Has this member been removed from the rotation?
    fn is_defaulted(env: &Env, group_id: u64, member: &Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Defaulted(group_id, member.clone()))
            .unwrap_or(false)
    }

    /// Mark a member defaulted and refund only what they still have sitting in
    /// the pool. Idempotent-safe callers only (guarded by is_defaulted upstream).
    ///
    /// The refund is their `Unrotated` balance — contributions from cycles that
    /// have NOT yet paid out. It deliberately is NOT `PaidTotal`: once a cycle
    /// pays out, that money went to a recipient, and the pool now holds the
    /// CURRENT cycle's contributions from other members. Refunding a lifetime
    /// total would hand the defaulter those other members' money, and a member
    /// who already collected their own payout would be paid twice.
    fn remove_member(
        env: &Env,
        group_id: u64,
        member: &Address,
        config: &GroupConfig,
        token_client: &token::Client,
    ) {
        let storage = env.storage().persistent();

        storage.set(&DataKey::Defaulted(group_id, member.clone()), &true);

        // Only this member's own unrotated contributions are refundable, and
        // never more than the pool actually holds.
        let unrotated: i128 = storage
            .get(&DataKey::Unrotated(group_id, member.clone()))
            .unwrap_or(0);
        let pool: i128 = storage.get(&DataKey::Pool(group_id)).unwrap_or(0);
        let refund = if unrotated > pool { pool } else { unrotated };

        // Effects before the external call (checks-effects-interactions).
        if refund > 0 {
            storage.set(&DataKey::Pool(group_id), &(pool - refund));
        }
        // They keep no debt and no future claim.
        storage.remove(&DataKey::PaidTotal(group_id, member.clone()));
        storage.remove(&DataKey::Unrotated(group_id, member.clone()));
        storage.remove(&DataKey::LateFees(group_id, member.clone()));

        if refund > 0 {
            Self::assert_covers(env, token_client, refund);
            token_client.transfer(
                &env.current_contract_address(),
                member,
                &refund,
            );
        }

        // A removed member cannot be the awaited recipient, so mark them
        // Received too — keeps remaining_recipients() and the payout scan honest.
        storage.set(&DataKey::Received(group_id, member.clone()), &true);

        env.events()
            .publish((symbol_short!("removed"), group_id), member.clone());

        // COMPLETION IS RE-EVALUATED HERE, not only in trigger_payout.
        //
        // Marking the removed member Received can take remaining_recipients() to
        // zero. Previously only trigger_payout checked that, so a removal which
        // emptied the rotation left the group Active with a non-empty Pool and no
        // reachable recipient: trigger_payout's scan found nobody, returned
        // WrongStatus, and did so forever. With no refund/cancel/sweep function
        // the remaining escrow was permanently unrecoverable.
        let members: Vec<Address> = storage
            .get(&DataKey::Members(group_id))
            .unwrap_or_else(|| Vec::new(env));

        if Self::remaining_recipients(env, group_id, &members) == 0 {
            Self::settle_residual_pool(env, group_id, &members, token_client);

            let mut done = config.clone();
            done.status = Status::Completed;
            storage.set(&DataKey::Config(group_id), &done);
            env.events()
                .publish((symbol_short!("grp_done"), group_id), ());
        }
    }

    /// Hand the open cycle's pool back to the members who funded it, as
    /// claimable balances, when a circle completes without a final payout.
    ///
    /// Basis is `Unrotated` — contributions from cycles that have not yet paid
    /// out — which is exactly "money in the pool that is still morally theirs".
    /// Paid out as `Claimable` rather than pushed, so it follows the same
    /// non-custodial rule as every other payout: funds move only on the owner's
    /// signature, and a member whose wallet cannot receive the token can't brick
    /// the settlement for everyone else.
    fn settle_residual_pool(
        env: &Env,
        group_id: u64,
        members: &Vec<Address>,
        token_client: &token::Client,
    ) {
        let storage = env.storage().persistent();

        let pool: i128 = storage.get(&DataKey::Pool(group_id)).unwrap_or(0);
        if pool <= 0 {
            return;
        }

        let mut total: i128 = 0;
        for m in members.iter() {
            total += storage
                .get::<DataKey, i128>(&DataKey::Unrotated(group_id, m.clone()))
                .unwrap_or(0);
        }

        // Nobody has an unrotated claim (every contribution already rotated out).
        // Leave the pool untouched rather than inventing a distribution.
        if total <= 0 {
            return;
        }

        Self::assert_covers(env, token_client, pool);

        let mut distributed: i128 = 0;
        let mut last: Option<Address> = None;

        for m in members.iter() {
            let basis: i128 = storage
                .get(&DataKey::Unrotated(group_id, m.clone()))
                .unwrap_or(0);
            if basis <= 0 {
                continue;
            }

            let share = pool * basis / total;
            if share > 0 {
                let prev: i128 = storage
                    .get(&DataKey::Claimable(group_id, m.clone()))
                    .unwrap_or(0);
                storage.set(&DataKey::Claimable(group_id, m.clone()), &(prev + share));
                distributed += share;
            }
            storage.remove(&DataKey::Unrotated(group_id, m.clone()));
            last = Some(m);
        }

        // Integer division truncates, so a few stroops can be left over. Give
        // them to the last funder rather than stranding them in the contract:
        // the pool must end at exactly zero or the dust is unrecoverable.
        let dust = pool - distributed;
        if dust > 0 {
            if let Some(m) = last {
                let prev: i128 = storage
                    .get(&DataKey::Claimable(group_id, m.clone()))
                    .unwrap_or(0);
                storage.set(&DataKey::Claimable(group_id, m), &(prev + dust));
            }
        }

        storage.set(&DataKey::Pool(group_id), &0i128);
    }

    /// Whose turn it is right now: the first member in rotation order who is
    /// neither defaulted nor already paid, or None once everyone has received.
    ///
    /// Deliberately a SCAN, not `members[cycle]`. Indexing by the raw cycle
    /// number mis-assigns a slot the moment anyone is removed from the rotation.
    /// Shared by `contribute` (to exempt the recipient), `trigger_payout` (to
    /// pick who is paid and who owes) and the `next_recipient` view, so all
    /// three can never disagree about whose turn it is.
    fn current_recipient(env: &Env, group_id: u64, members: &Vec<Address>) -> Option<Address> {
        let storage = env.storage().persistent();
        for m in members.iter() {
            if Self::is_defaulted(env, group_id, &m) {
                continue;
            }
            let received = storage
                .get::<DataKey, bool>(&DataKey::Received(group_id, m.clone()))
                .unwrap_or(false);
            if !received {
                return Some(m);
            }
        }
        None
    }

    /// How many active (non-defaulted) members are still awaiting a payout.
    fn remaining_recipients(env: &Env, group_id: u64, members: &Vec<Address>) -> u32 {
        let storage = env.storage().persistent();
        let mut n = 0u32;
        for m in members.iter() {
            let received = storage
                .get::<DataKey, bool>(&DataKey::Received(group_id, m.clone()))
                .unwrap_or(false);
            // Defaulted members are marked Received in remove_member, so this
            // single check covers both "already paid" and "removed".
            if !received {
                n += 1;
            }
        }
        n
    }

    /// Guard every outbound transfer against the contract's REAL balance.
    ///
    /// All groups share one token balance, so per-group bookkeeping that drifts
    /// above reality would silently spend another group's escrow and strand it
    /// with no recovery path. This turns that into an immediate, loud failure
    /// instead of a slow leak across circles.
    fn assert_covers(env: &Env, token_client: &token::Client, amount: i128) {
        let held = token_client.balance(&env.current_contract_address());
        if held < amount {
            panic_with_error!(env, Error::InsufficientEscrow);
        }
    }

    /// Keep a group's keys alive. Called on every state change so an
    /// actively-used circle is never archived out from under its funds.
    ///
    /// Per-member money keys are bumped separately by `bump_member_ttl`, since
    /// they need the member's address. The per-(cycle, member) `Contributed`
    /// keys are short-lived by nature and are left to their default TTL.
    fn bump_ttl(env: &Env, group_id: u64) {
        let storage = env.storage().persistent();
        for key in [
            DataKey::Config(group_id),
            DataKey::Members(group_id),
            DataKey::Pool(group_id),
            DataKey::Cycle(group_id),
            DataKey::CycleStart(group_id),
        ] {
            if storage.has(&key) {
                storage.extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
            }
        }
    }

    /// Keep a member's money-bearing keys alive.
    ///
    /// `Claimable` holds real funds: if it is archived, `claim_payout` reads 0
    /// and the payout is stranded in the contract forever. `Received` is just as
    /// important for integrity — an archived entry reads `false`, which would
    /// let the same member be selected for a SECOND payout.
    fn bump_member_ttl(env: &Env, group_id: u64, member: &Address) {
        let storage = env.storage().persistent();
        for key in [
            DataKey::Claimable(group_id, member.clone()),
            DataKey::Received(group_id, member.clone()),
            DataKey::Defaulted(group_id, member.clone()),
            DataKey::PaidTotal(group_id, member.clone()),
            DataKey::Unrotated(group_id, member.clone()),
            DataKey::LateFees(group_id, member.clone()),
        ] {
            if storage.has(&key) {
                storage.extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
            }
        }
    }

    /// Keep a `(cycle, member)` contribution flag alive.
    ///
    /// These were deliberately left on the network's default persistent TTL as
    /// "short-lived by nature". That default is ~7 days on pubnet, while
    /// `cycle_length` can be a month — so for any circle with a cycle longer
    /// than the default, the early payers' flags ARCHIVE before the cycle
    /// closes. `trigger_payout` reads every one of them, so the payout
    /// transaction then fails on footprint access and the pool becomes
    /// unspendable until someone manually submits a RestoreFootprint — which
    /// nothing in this project does. Long circles bricked themselves.
    fn bump_contributed_ttl(env: &Env, group_id: u64, cycle: u32, member: &Address) {
        let storage = env.storage().persistent();
        let key = DataKey::Contributed(group_id, cycle, member.clone());
        if storage.has(&key) {
            storage.extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
        }
    }
}

mod test;
