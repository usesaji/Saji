#![no_std]

//! Saji Public Savings Challenge — Soroban contract.
//!
//! A challenge is a PERSONAL savings vault with a social wrapper: each member
//! saves their own money toward a target the creator set, and may withdraw any
//! part of it at any time. There is no pool, no rotation, no penalty, and no
//! lock — the target is motivational, not enforced, so this contract never
//! reads it (it lives in the app's database as a display figure).
//!
//! # Why this is a separate contract from `savings`
//!
//! A contract has exactly ONE token balance, however many storage keys it
//! keeps. In `savings`, every circle's escrow shares that single balance, and
//! per-group bookkeeping that drifts above reality spends another circle's
//! money — which is what its `InsufficientEscrow` guard exists to catch.
//!
//! Challenge withdrawal is UNCONDITIONAL (any member, any amount, any time),
//! whereas circle escrow only moves when a full cycle completes. Hosting the
//! permissive path in the same contract would point it at the pot holding
//! everyone's rotating savings. A separate contract means a separate address,
//! hence a separate token balance: a bug here can at worst drain challenge
//! deposits, and cannot reach circle escrow at all. That guarantee comes from
//! the platform rather than from this code being correct.
//!
//! # Invariants
//!
//! 1. Every balance key carries `challenge_id`, so one challenge's funds can
//!    never be addressed by another.
//! 2. A member can only ever withdraw against their OWN balance, and only what
//!    they actually hold (no overdraw, no negative balance).
//! 3. The contract's real token balance always covers the sum of every member's
//!    recorded balance (solvency).
//! 4. Every money movement is authorized by the acting member's own wallet.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error,
    symbol_short, token, Address, Env,
};

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/// Storage keys. Every balance key carries the `challenge_id` so funds for one
/// challenge can never be addressed by another (invariant #1).
#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    /// (challenge_id, member) -> the token THIS MEMBER saves in. Set by their
    /// first deposit and immutable thereafter, so a later deposit cannot mix a
    /// second asset into a balance figure denominated in the first.
    ///
    /// Keyed per member, not per challenge. A challenge-wide key made the token
    /// first-writer-wins across ALL members, and `deposit` has no membership or
    /// existence check while `challenge_id` is the app's sequential group id —
    /// so anyone could deposit 1 stroop of a worthless self-issued token into
    /// challenge N+1, N+2, ... before the real members arrived, permanently
    /// pinning those challenges to junk. Every legitimate deposit then failed
    /// with WrongToken, with no admin override and no way to reset. Per-member
    /// keying preserves the actual invariant (one member's balance is in one
    /// asset) while making the griefing self-inflicted only.
    Token(u64, Address),
    /// (challenge_id, member) -> how much this member currently has escrowed.
    /// Increases on deposit, decreases on withdrawal. This is the ONLY record
    /// of ownership; there is no pool.
    Balance(u64, Address),
}

#[contracterror]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u32)]
pub enum Error {
    /// Deposit or withdrawal amount was zero or negative.
    InvalidAmount = 1,
    /// The member has no balance in this challenge, or asked for more than they
    /// hold. Withdrawing is capped at what you put in (invariant #2).
    InsufficientBalance = 2,
    /// A deposit named a different token than the challenge already holds.
    /// Balances are denominated in one token; mixing them would make the
    /// recorded figures meaningless.
    WrongToken = 3,
    /// The withdrawal destination is the contract itself. That would clear the
    /// balance while the tokens never left, destroying the savings with no way
    /// to recover them.
    InvalidDestination = 4,
    /// A transfer would exceed what the contract actually holds. Catches
    /// bookkeeping drifting above reality before it can spend another
    /// challenge's escrow (invariant #3).
    InsufficientEscrow = 5,
}

// Persistent-storage lifetime. Soroban archives persistent entries once their
// TTL lapses; an archived balance would be unspendable. A savings challenge can
// run for months, so the TTL of a member's live keys is extended on every state
// change. ~30 days low-watermark, bumped to ~90 days.
// (1 ledger ≈ 5s ⇒ 17_280 ledgers/day.)
const LEDGERS_PER_DAY: u32 = 17_280;
const TTL_THRESHOLD: u32 = 30 * LEDGERS_PER_DAY;
const TTL_EXTEND_TO: u32 = 90 * LEDGERS_PER_DAY;

// ----------------------------------------------------------------------------
// Contract
// ----------------------------------------------------------------------------

#[contract]
pub struct ChallengeContract;

#[contractimpl]
impl ChallengeContract {
    /// Save `amount` toward a challenge. The member authorizes with their own
    /// wallet and the token is pulled into the contract (escrow), credited to
    /// their personal balance.
    ///
    /// No membership check happens here: joining a challenge is an app-level,
    /// off-chain concept with no money attached, and gating deposits on it
    /// would mean trusting an on-chain member list this contract has no reason
    /// to maintain. Depositing to a challenge you haven't joined credits you
    /// normally and is harmless — the funds remain yours and withdrawable.
    ///
    /// `challenge_id` is the app's group id, so the app can address a
    /// challenge's balances without extra bookkeeping here.
    pub fn deposit(
        env: Env,
        challenge_id: u64,
        member: Address,
        token: Address,
        amount: i128,
    ) -> Result<(), Error> {
        member.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let storage = env.storage().persistent();

        // The token is fixed by the first deposit. Without this, a later
        // deposit in a different token would be added to the same balance
        // figure, and a withdrawal could then pay out the wrong asset.
        let token_key = DataKey::Token(challenge_id, member.clone());
        match storage.get::<DataKey, Address>(&token_key) {
            Some(existing) => {
                if existing != token {
                    return Err(Error::WrongToken);
                }
            }
            None => storage.set(&token_key, &token),
        }

        // Pull the funds from the member into the contract (escrow).
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&member, &env.current_contract_address(), &amount);

        let balance_key = DataKey::Balance(challenge_id, member.clone());
        let balance: i128 = storage.get(&balance_key).unwrap_or(0);
        storage.set(&balance_key, &(balance + amount));

        env.events().publish(
            (symbol_short!("save"), challenge_id, member.clone()),
            amount,
        );

        Self::bump_ttl(&env, challenge_id, &member);
        Ok(())
    }

    /// Withdraw `amount` of the member's own savings to `to`.
    ///
    /// UNCONDITIONAL by design: there is no target check, no deadline, and no
    /// status. Whether the member reached their goal, gave up, or simply
    /// changed their mind, the money is theirs and this is the same code path.
    /// The only rule is that you cannot take out more than you put in.
    ///
    /// `member.require_auth()` means naming a destination is the member's
    /// choice alone — nobody else can redirect their savings. `to` is otherwise
    /// unrestricted so they can withdraw straight to any wallet they choose;
    /// it may equal `member`.
    ///
    /// The balance stays keyed on `member` (not `to`), so a withdrawal to a
    /// third party still debits the right account and can't be replayed.
    ///
    /// Note: if `to` holds no trustline for the challenge's token the transfer
    /// panics and the whole withdrawal reverts — the savings stay escrowed, so
    /// nothing is lost. Callers should check first.
    ///
    /// Returns the member's remaining balance.
    pub fn withdraw(
        env: Env,
        challenge_id: u64,
        member: Address,
        to: Address,
        amount: i128,
    ) -> Result<i128, Error> {
        member.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        // Paying the contract itself would clear the balance while the tokens
        // never moved, destroying the savings with no recovery path.
        if to == env.current_contract_address() {
            return Err(Error::InvalidDestination);
        }

        let storage = env.storage().persistent();

        let balance_key = DataKey::Balance(challenge_id, member.clone());
        let balance: i128 = storage.get(&balance_key).unwrap_or(0);
        if balance < amount {
            return Err(Error::InsufficientBalance);
        }

        let token: Address = storage
            .get(&DataKey::Token(challenge_id, member.clone()))
            .ok_or(Error::InsufficientBalance)?;
        let token_client = token::Client::new(&env, &token);

        // Solvency backstop (invariant #3): never transfer more than the
        // contract actually holds, so bookkeeping that has drifted above
        // reality fails loudly here instead of quietly spending another
        // challenge's escrow.
        Self::assert_covers(&env, &token_client, amount);

        // Debit BEFORE transferring, so a re-entrant call during the transfer
        // sees the reduced balance and cannot withdraw the same funds twice.
        let remaining = balance - amount;
        if remaining == 0 {
            storage.remove(&balance_key);
        } else {
            storage.set(&balance_key, &remaining);
        }

        token_client.transfer(&env.current_contract_address(), &to, &amount);

        // `to` is published so the indexer can see where the funds went.
        env.events().publish(
            (symbol_short!("withdraw"), challenge_id, member.clone(), to),
            amount,
        );

        Self::bump_ttl(&env, challenge_id, &member);
        Ok(remaining)
    }

    /// How much this member currently has saved in this challenge. Read-only.
    ///
    /// This is the app's source of truth for progress: the figure is the money
    /// itself, not a record of it, so it cannot disagree with reality.
    pub fn balance_of(env: Env, challenge_id: u64, member: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(challenge_id, member))
            .unwrap_or(0)
    }

    /// The token this member's savings in this challenge are denominated in, or
    /// None before their first deposit. Read-only.
    pub fn token_of(env: Env, challenge_id: u64, member: Address) -> Option<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::Token(challenge_id, member))
    }

    // ------------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------------

    /// Guard: the contract must actually hold `amount` before promising it.
    ///
    /// Challenges share one token balance with each other (though not with the
    /// savings contract), so a per-challenge figure that drifts above reality
    /// would silently spend another challenge's escrow and strand it with no
    /// recovery path. This turns that into an immediate, loud failure instead
    /// of a slow leak.
    fn assert_covers(env: &Env, token_client: &token::Client, amount: i128) {
        let held = token_client.balance(&env.current_contract_address());
        if held < amount {
            panic_with_error!(env, Error::InsufficientEscrow);
        }
    }

    /// Keep a member's balance keys alive. Called on every state change so an
    /// actively-used challenge is never archived out from under its funds.
    fn bump_ttl(env: &Env, challenge_id: u64, member: &Address) {
        let storage = env.storage().persistent();
        for key in [
            DataKey::Token(challenge_id, member.clone()),
            DataKey::Balance(challenge_id, member.clone()),
        ] {
            if storage.has(&key) {
                storage.extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
            }
        }
    }
}

mod test;
