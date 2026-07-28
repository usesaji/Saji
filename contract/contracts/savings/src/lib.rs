#![no_std]

//! Saji Savings Group — Soroban contract.
//!
//! One contract, many groups keyed by `group_id`. The contract escrows the
//! pooled token (USDC) and rotates payouts. Non-custodial: every money action
//! is authorized by the acting party's own wallet via `require_auth`. See
//! `SPEC.md` for the full design and invariants.

use soroban_sdk::{
    contract, contractimpl, contracterror, contracttype, symbol_short,
    token, Address, Env, Vec,
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

/// What happens to a member who misses a contribution. Stored on-chain so the
/// rule is auditable; enforcement ships with the future `resolve_default` hook
/// (SPEC §7). The strict "everyone pays" rule still governs the MVP.
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
}

const BPS_DENOMINATOR: i128 = 10_000;

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
        if fee_bps > BPS_DENOMINATOR as u32 || late_fee_bps > BPS_DENOMINATOR as u32 {
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

        let cycle: u32 = storage.get(&DataKey::Cycle(group_id)).unwrap_or(0);
        let paid_key = DataKey::Contributed(group_id, cycle, member.clone());
        if storage.get::<DataKey, bool>(&paid_key).unwrap_or(false) {
            return Err(Error::AlreadyContributed);
        }

        // Pull funds from the member into the contract (escrow).
        let token_client = token::Client::new(&env, &config.token);
        token_client.transfer(
            &member,
            &env.current_contract_address(),
            &config.amount,
        );

        storage.set(&paid_key, &true);
        let pool: i128 = storage.get(&DataKey::Pool(group_id)).unwrap_or(0);
        storage.set(&DataKey::Pool(group_id), &(pool + config.amount));

        env.events().publish(
            (symbol_short!("contrib"), group_id, member),
            (cycle, config.amount),
        );

        Self::bump_ttl(&env, group_id);
        Ok(())
    }

    /// Pay the current cycle's recipient. Callable by anyone (e.g. the backend
    /// scheduler) since it can only ever pay the rules-determined recipient.
    /// Strict rule: reverts unless every member has contributed this cycle.
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

        // Strict completeness: everyone must have paid this cycle.
        for m in members.iter() {
            let paid = storage
                .get::<DataKey, bool>(&DataKey::Contributed(group_id, cycle, m.clone()))
                .unwrap_or(false);
            if !paid {
                return Err(Error::NotAllContributed);
            }
        }

        // Recipient is the member at this cycle's index in the rotation.
        let recipient = members.get(cycle).ok_or(Error::GroupNotFound)?;

        let pool: i128 = storage.get(&DataKey::Pool(group_id)).unwrap_or(0);
        let fee: i128 = pool * config.fee_bps as i128 / BPS_DENOMINATOR;
        let net: i128 = pool - fee;

        let token_client = token::Client::new(&env, &config.token);
        let contract_addr = env.current_contract_address();
        if fee > 0 {
            token_client.transfer(&contract_addr, &config.organizer, &fee);
        }
        token_client.transfer(&contract_addr, &recipient, &net);

        // Pool is fully disbursed (conservation, invariant #5).
        storage.set(&DataKey::Pool(group_id), &0i128);
        storage.set(&DataKey::Received(group_id, recipient.clone()), &true);

        env.events().publish(
            (symbol_short!("payout"), group_id),
            (cycle, recipient, pool, fee, net),
        );

        // Advance rotation. One payout per member => rotation length == members.
        let next_cycle = cycle + 1;
        if next_cycle >= config.member_count {
            config.status = Status::Completed;
            storage.set(&DataKey::Config(group_id), &config);
            env.events()
                .publish((symbol_short!("grp_done"), group_id), ());
        } else {
            storage.set(&DataKey::Cycle(group_id), &next_cycle);
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

    /// The address that will receive the current cycle's payout.
    pub fn next_recipient(env: Env, group_id: u64) -> Result<Address, Error> {
        let storage = env.storage().persistent();
        let members: Vec<Address> = storage
            .get(&DataKey::Members(group_id))
            .ok_or(Error::GroupNotFound)?;
        let cycle: u32 = storage.get(&DataKey::Cycle(group_id)).unwrap_or(0);
        members.get(cycle).ok_or(Error::GroupNotFound)
    }

    pub fn has_contributed(env: Env, group_id: u64, cycle: u32, member: Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Contributed(group_id, cycle, member))
            .unwrap_or(false)
    }

    // ---- internal ----

    fn load_config(env: &Env, group_id: u64) -> Result<GroupConfig, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Config(group_id))
            .ok_or(Error::GroupNotFound)
    }

    /// Keep a group's core keys alive. Called on every state change so an
    /// actively-used circle is never archived out from under its funds. The
    /// per-(cycle, member) `Contributed` keys are short-lived by nature and are
    /// left to their default TTL.
    fn bump_ttl(env: &Env, group_id: u64) {
        let storage = env.storage().persistent();
        for key in [
            DataKey::Config(group_id),
            DataKey::Members(group_id),
            DataKey::Pool(group_id),
            DataKey::Cycle(group_id),
        ] {
            if storage.has(&key) {
                storage.extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
            }
        }
    }
}

mod test;
