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

// Persistent-storage lifetime. Soroban archives persistent entries once their
// TTL lapses; an archived group would be unspendable. A savings circle can run
// for many cycles across weeks/months, so we extend the TTL of a group's live
// keys on every state change. ~30 days low-watermark, bumped to ~90 days.
// (1 ledger ≈ 5s ⇒ 17_280 ledgers/day.)
const LEDGERS_PER_DAY: u32 = 17_280;
const TTL_THRESHOLD: u32 = 30 * LEDGERS_PER_DAY;
const TTL_EXTEND_TO: u32 = 90 * LEDGERS_PER_DAY;

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
        // Service fee is capped at MAX_FEE_BPS (10%) to prevent a confiscatory
        // fee; the late fee is a penalty and may range up to 100% of `amount`.
        if fee_bps > MAX_FEE_BPS || late_fee_bps > BPS_DENOMINATOR as u32 {
            return Err(Error::InvalidFee);
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

        let cycle: u32 = storage.get(&DataKey::Cycle(group_id)).unwrap_or(0);
        let paid_key = DataKey::Contributed(group_id, cycle, member.clone());
        if storage.get::<DataKey, bool>(&paid_key).unwrap_or(false) {
            return Err(Error::AlreadyContributed);
        }

        // Effects BEFORE the external call (checks-effects-interactions): the
        // token is an arbitrary contract address, so its `transfer` is untrusted
        // code. Writing state first means a reentrant call sees this cycle as
        // already paid and is rejected by the guard above.
        storage.set(&paid_key, &true);
        let pool: i128 = storage.get(&DataKey::Pool(group_id)).unwrap_or(0);
        storage.set(&DataKey::Pool(group_id), &(pool + config.amount));
        // Track lifetime contributions (audit/UI) and the portion not yet
        // rotated out, which is the only part a refund may draw on.
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
        token_client.transfer(
            &member,
            &env.current_contract_address(),
            &config.amount,
        );

        env.events().publish(
            (symbol_short!("contrib"), group_id, member.clone()),
            (cycle, config.amount),
        );

        Self::bump_ttl(&env, group_id);
        Self::bump_member_ttl(&env, group_id, &member);
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

        // Completeness over ACTIVE members only (defaulted members are skipped).
        for m in members.iter() {
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

        // Recipient: first member in rotation order who is active and not yet
        // paid. Decoupled from `cycle` as a raw index so skipping a removed
        // member never mis-assigns or double-pays a slot (invariant #4).
        let mut recipient: Option<Address> = None;
        for m in members.iter() {
            if Self::is_defaulted(&env, group_id, &m) {
                continue;
            }
            let received = storage
                .get::<DataKey, bool>(&DataKey::Received(group_id, m.clone()))
                .unwrap_or(false);
            if !received {
                recipient = Some(m);
                break;
            }
        }
        let recipient = recipient.ok_or(Error::WrongStatus)?; // none left ⇒ done

        let pool: i128 = storage.get(&DataKey::Pool(group_id)).unwrap_or(0);
        let service_fee: i128 = pool * config.fee_bps as i128 / BPS_DENOMINATOR;
        // Late-fee debt this recipient owes, capped so it can never exceed what
        // they'd receive (never make a payout negative).
        let owed: i128 = storage
            .get(&DataKey::LateFees(group_id, recipient.clone()))
            .unwrap_or(0);
        let after_service = pool - service_fee;
        let late_fee = if owed > after_service { after_service } else { owed };
        let fee: i128 = service_fee + late_fee; // total to organizer
        let net: i128 = pool - fee;

        let token_client = token::Client::new(&env, &config.token);
        let contract_addr = env.current_contract_address();

        // Record the recipient's net as claimable (add to any existing balance so
        // an unclaimed earlier payout is never lost). Draw it out of the pool.
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

        // Pool now holds only the escrowed claimable(s); the net is earmarked.
        // Mark the recipient as having received (their turn is done in the
        // rotation) and clear their settled late-fee debt.
        storage.set(&DataKey::Pool(group_id), &0i128);
        storage.set(&DataKey::Received(group_id, recipient.clone()), &true);
        storage.remove(&DataKey::LateFees(group_id, recipient.clone()));

        // Interaction last: only the organizer's fee actually leaves now. The
        // recipient's net stays escrowed until they claim it.
        if fee > 0 {
            Self::assert_covers(&env, &token_client, fee);
            token_client.transfer(&contract_addr, &config.organizer, &fee);
        }

        env.events().publish(
            (symbol_short!("payout"), group_id),
            (cycle, recipient, pool, fee, net),
        );

        // Advance the cycle counter and re-anchor the grace clock. Completion is
        // decided by whether any ACTIVE member is still waiting to be paid, not
        // by a raw count — so removals shrink the rotation correctly.
        storage.set(&DataKey::Cycle(group_id), &(cycle + 1));
        storage.set(&DataKey::CycleStart(group_id), &env.ledger().timestamp());

        if Self::remaining_recipients(&env, group_id, &members) == 0 {
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

        config.organizer.require_auth();

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
        let started: u64 = storage.get(&DataKey::CycleStart(group_id)).unwrap_or(0);
        let deadline = started
            .saturating_add(config.cycle_length)
            .saturating_add(config.grace_period);
        if env.ledger().timestamp() < deadline {
            return Err(Error::NotDefaultable);
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
        let storage = env.storage().persistent();
        let members: Vec<Address> = storage
            .get(&DataKey::Members(group_id))
            .ok_or(Error::GroupNotFound)?;
        for m in members.iter() {
            let received = storage
                .get::<DataKey, bool>(&DataKey::Received(group_id, m.clone()))
                .unwrap_or(false);
            // Defaulted members are marked Received, so this covers both.
            if !received {
                return Ok(m);
            }
        }
        Err(Error::GroupNotFound) // no active members left awaiting payout
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

        let _ = config;
        env.events()
            .publish((symbol_short!("removed"), group_id), member.clone());
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
}

mod test;
