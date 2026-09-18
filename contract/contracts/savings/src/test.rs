#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::{StellarAssetClient, TokenClient},
    Address, Env,
};

/// The cycle length every helper below creates groups with (7 days).
const CYCLE_LENGTH: u64 = 604_800;

/// Test harness: a contract, a mock USDC token, and helpers to mint/register.
struct Setup {
    env: Env,
    client: SavingsContractClient<'static>,
    token: Address,
    token_admin: StellarAssetClient<'static>,
    token_client: TokenClient<'static>,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(SavingsContract, ());
    let client = SavingsContractClient::new(&env, &contract_id);

    // Mock Stellar Asset Contract standing in for USDC.
    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer);
    let token = sac.address();
    let token_admin = StellarAssetClient::new(&env, &token);
    let token_client = TokenClient::new(&env, &token);

    Setup { env, client, token, token_admin, token_client }
}

impl Setup {
    /// Advance the ledger past the current cycle so `trigger_payout` is allowed.
    ///
    /// The contract enforces `cycle_length` as a FLOOR: a cycle cannot pay out
    /// before it is actually over, however quickly everyone contributed. That
    /// is the whole point of a rotating SAVINGS circle — without it a "monthly"
    /// group where everyone is prompt completes every cycle in an afternoon and
    /// nobody gains the time transfer they joined for.
    fn end_cycle(&self) {
        let now = self.env.ledger().timestamp();
        self.env.ledger().set_timestamp(now + CYCLE_LENGTH + 1);
    }

    /// Contribute for `member` unless they are this cycle's recipient.
    ///
    /// The recipient is EXEMPT — the pot they are about to collect is funded by
    /// everyone else, so paying into it would revert with `RecipientExempt`.
    /// Tests that just need "the cycle is funded" use this rather than caring
    /// which position the rotation is currently on.
    fn pay_if_owed(&self, group_id: &u64, member: &Address) {
        if self.client.next_recipient(group_id) != *member {
            self.client.contribute(group_id, member);
        }
    }

    /// Fund the current cycle from every member who owes it.
    fn fund_cycle(&self, group_id: &u64, members: &soroban_sdk::Vec<Address>) {
        for m in members.iter() {
            self.pay_if_owed(group_id, &m);
        }
    }

    /// Open the next cycle's deposit window (payouts are immediate; the
    /// SCHEDULE is enforced on deposits).
    fn open_next_round(&self, group_id: &u64) {
        let opens = self.client.deposits_open_at(group_id);
        if self.env.ledger().timestamp() < opens {
            self.env.ledger().set_timestamp(opens);
        }
    }

    /// Create a funded member address holding `balance` of the token.
    fn funded_member(&self, balance: i128) -> Address {
        let addr = Address::generate(&self.env);
        self.token_admin.mint(&addr, &balance);
        addr
    }

    /// THE solvency invariant: the contract's real token balance must always
    /// cover everything it owes — every group's `Pool` plus every member's
    /// unclaimed `Claimable`.
    ///
    /// All groups share ONE token balance, so per-group bookkeeping that drifts
    /// above reality silently spends another group's escrow. Assert this after
    /// every money-moving operation; it is the single check that catches
    /// over-refunding, double-crediting, and cross-group leakage.
    fn assert_solvent(&self, groups: &[(u64, &[Address])]) {
        let held = self.token_client.balance(&self.client.address);
        let mut owed = 0i128;
        for (group_id, members) in groups {
            owed += self.client.get_pool(group_id);
            for m in members.iter() {
                owed += self.client.claimable_of(group_id, m);
            }
        }
        assert!(
            held >= owed,
            "INSOLVENT: contract holds {held} but owes {owed} (short by {})",
            owed - held,
        );
    }
}

/// Build an Active group of `n` members each contributing `amount`, with the
/// given fee. Returns (group_id, organizer, members).
fn active_group(s: &Setup, n: u32, amount: i128, fee_bps: u32) -> (u64, Address, soroban_sdk::Vec<Address>) {
    let organizer = s.funded_member(amount * 10);
    let group_id = s.client.create_group(
        &organizer, &s.token, &amount, &604_800, &fee_bps,
        &0u32, &0u64, &PayoutOrder::Manual, &LatePenalty::DeductFromBalance,
    );

    let mut members = soroban_sdk::Vec::new(&s.env);
    members.push_back(organizer.clone());
    for _ in 1..n {
        let m = s.funded_member(amount * 10);
        s.client.join_group(&group_id, &m);
        members.push_back(m);
    }
    s.client.start_cycle(&group_id);
    (group_id, organizer, members)
}

// ---- Happy path ----

#[test]
fn full_cycle_pays_recipient_with_fee() {
    let s = setup();
    let amount = 50_000_000i128; // 5 USDC (7 decimals)
    let fee_bps = 100; // 1%
    let (group_id, _organizer, members) = active_group(&s, 3, amount, fee_bps);

    // Everyone contributes cycle 0.
    s.fund_cycle(&group_id, &members);

    let recipient = members.get(0).unwrap(); // organizer, cycle 0 -> index 0
    let recipient_before = s.token_client.balance(&recipient);

    s.end_cycle();
    s.client.trigger_payout(&group_id);

    // (n - 1) x amount: the recipient is exempt from funding their own pot.
    let pool = amount * 2;
    let fee = pool * fee_bps as i128 / 10_000;
    let net = pool - fee;

    // Pull-based: the payout does NOT hit the recipient's wallet yet. The fee
    // (service charge) leaves to the organizer immediately; the net becomes
    // claimable. Here recipient == organizer, so their wallet gains only the fee
    // now, and `net` is recorded as claimable.
    assert_eq!(s.token_client.balance(&recipient), recipient_before + fee);
    assert_eq!(s.client.claimable_of(&group_id, &recipient), net);

    // Cycle pool accounting is cleared (the net is earmarked, fee is gone).
    assert_eq!(s.client.get_pool(&group_id), 0);

    // The recipient claims → net moves to their wallet, claimable clears.
    let claimed = s.client.claim_payout(&group_id, &recipient, &recipient);
    assert_eq!(claimed, net);
    assert_eq!(s.token_client.balance(&recipient), recipient_before + fee + net);
    assert_eq!(s.client.claimable_of(&group_id, &recipient), 0);
}

// ---- One-shot launch: start_with_members ----

#[test]
fn start_with_members_admits_roster_orders_and_starts_in_one_call() {
    let s = setup();
    let amount = 10_000_000i128;

    // Organizer creates the group (member #1). No one else joined on-chain yet.
    let organizer = s.funded_member(amount * 10);
    let group_id = s.client.create_group(
        &organizer, &s.token, &amount, &604_800, &0,
        &0u32, &0u64, &PayoutOrder::Manual, &LatePenalty::DeductFromBalance,
    );
    let m2 = s.funded_member(amount * 10);
    let m3 = s.funded_member(amount * 10);

    // Launch the whole roster + payout order + start, in one call. Order puts m3
    // first, then organizer, then m2.
    let mut order = soroban_sdk::Vec::new(&s.env);
    order.push_back(m3.clone());
    order.push_back(organizer.clone());
    order.push_back(m2.clone());
    s.client.start_with_members(&group_id, &order);

    // Active, all three admitted, and m3 is the first recipient.
    assert_eq!(s.client.get_group(&group_id).status, Status::Active);
    assert_eq!(s.client.get_members(&group_id).len(), 3);
    assert_eq!(s.client.next_recipient(&group_id), m3);

    // The full cycle works end-to-end from this launch.
    for m in order.iter() {
        s.pay_if_owed(&group_id, &m);
    }
    s.end_cycle();
    s.client.trigger_payout(&group_id);
    // m3 receives (n - 1) x amount — they do not pay into their own pot.
    assert_eq!(s.client.claimable_of(&group_id, &m3), amount * 2);
}

#[test]
fn start_with_members_rejects_fewer_than_two() {
    let s = setup();
    let amount = 10_000_000i128;
    let organizer = s.funded_member(amount);
    let group_id = s.client.create_group(
        &organizer, &s.token, &amount, &604_800, &0,
        &0u32, &0u64, &PayoutOrder::Manual, &LatePenalty::DeductFromBalance,
    );
    let mut order = soroban_sdk::Vec::new(&s.env);
    order.push_back(organizer.clone());
    let res = s.client.try_start_with_members(&group_id, &order);
    assert_eq!(res, Err(Ok(Error::TooFewMembers)));
}

#[test]
fn start_with_members_rejects_missing_organizer() {
    let s = setup();
    let amount = 10_000_000i128;
    let organizer = s.funded_member(amount);
    let group_id = s.client.create_group(
        &organizer, &s.token, &amount, &604_800, &0,
        &0u32, &0u64, &PayoutOrder::Manual, &LatePenalty::DeductFromBalance,
    );
    let m2 = s.funded_member(amount);
    let m3 = s.funded_member(amount);
    // Order omits the organizer → InvalidOrder.
    let mut order = soroban_sdk::Vec::new(&s.env);
    order.push_back(m2);
    order.push_back(m3);
    let res = s.client.try_start_with_members(&group_id, &order);
    assert_eq!(res, Err(Ok(Error::InvalidOrder)));
}

#[test]
fn start_with_members_rejects_duplicates() {
    let s = setup();
    let amount = 10_000_000i128;
    let organizer = s.funded_member(amount);
    let group_id = s.client.create_group(
        &organizer, &s.token, &amount, &604_800, &0,
        &0u32, &0u64, &PayoutOrder::Manual, &LatePenalty::DeductFromBalance,
    );
    let m2 = s.funded_member(amount);
    // organizer listed twice → InvalidOrder.
    let mut order = soroban_sdk::Vec::new(&s.env);
    order.push_back(organizer.clone());
    order.push_back(m2);
    order.push_back(organizer.clone());
    let res = s.client.try_start_with_members(&group_id, &order);
    assert_eq!(res, Err(Ok(Error::InvalidOrder)));
}

#[test]
#[should_panic] // Error #16 NothingToClaim
fn claim_without_a_payout_reverts() {
    let s = setup();
    let amount = 10_000_000i128;
    let (group_id, _org, members) = active_group(&s, 2, amount, 0);
    // m2 has never been paid out → nothing to claim.
    let m2 = members.get(1).unwrap();
    s.client.claim_payout(&group_id, &m2, &m2);
}

#[test]
fn double_claim_reverts_second_time() {
    let s = setup();
    let amount = 10_000_000i128;
    let (group_id, _org, members) = active_group(&s, 2, amount, 0);
    s.fund_cycle(&group_id, &members);
    let recipient = s.client.next_recipient(&group_id);
    s.end_cycle();
    s.client.trigger_payout(&group_id);

    // First claim succeeds and moves the funds.
    let claimed = s.client.claim_payout(&group_id, &recipient, &recipient);
    assert_eq!(claimed, amount); // 2 members, recipient exempt -> 1 payer
    assert_eq!(s.client.claimable_of(&group_id, &recipient), 0);

    // Second claim finds nothing → typed error (no double-withdraw).
    let res = s.client.try_claim_payout(&group_id, &recipient, &recipient);
    assert_eq!(res, Err(Ok(Error::NothingToClaim)));

    // …and naming a DIFFERENT destination doesn't resurrect it. The claimable
    // entry is keyed on the member, so a fresh `to` is not a fresh claim.
    let elsewhere = s.funded_member(0);
    let res = s.client.try_claim_payout(&group_id, &recipient, &elsewhere);
    assert_eq!(res, Err(Ok(Error::NothingToClaim)));
    assert_eq!(s.token_client.balance(&elsewhere), 0);
}

#[test]
fn claim_pays_a_third_party_address() {
    let s = setup();
    let amount = 10_000_000i128;
    let (group_id, _org, members) = active_group(&s, 2, amount, 0);
    s.fund_cycle(&group_id, &members);
    let recipient = s.client.next_recipient(&group_id);
    s.end_cycle();
    s.client.trigger_payout(&group_id);

    // An external wallet the member wants paid — not a circle member.
    let destination = s.funded_member(0);
    let recipient_before = s.token_client.balance(&recipient);

    let claimed = s.client.claim_payout(&group_id, &recipient, &destination);

    // The whole payout lands at the destination…
    assert_eq!(claimed, amount); // 2 members, recipient exempt -> 1 payer
    assert_eq!(s.token_client.balance(&destination), amount);
    // …and never touches the member's own wallet.
    assert_eq!(s.token_client.balance(&recipient), recipient_before);
    // The claim is settled and can't be replayed.
    assert_eq!(s.client.claimable_of(&group_id, &recipient), 0);
}

#[test]
fn claim_to_self_still_works() {
    // Regression guard: `to == member` must behave exactly as before the
    // destination parameter existed.
    let s = setup();
    let amount = 10_000_000i128;
    let (group_id, _org, members) = active_group(&s, 2, amount, 0);
    s.fund_cycle(&group_id, &members);
    let recipient = s.client.next_recipient(&group_id);
    let before = s.token_client.balance(&recipient);
    s.end_cycle();
    s.client.trigger_payout(&group_id);

    let claimed = s.client.claim_payout(&group_id, &recipient, &recipient);

    assert_eq!(claimed, amount); // 2 members, recipient exempt -> 1 payer
    assert_eq!(s.token_client.balance(&recipient), before + amount);
    assert_eq!(s.client.claimable_of(&group_id, &recipient), 0);
}

#[test]
fn full_rotation_pays_each_member_once_then_completes() {
    let s = setup();
    let amount = 10_000_000i128;
    let (group_id, _org, members) = active_group(&s, 3, amount, 0);

    let mut received = soroban_sdk::Vec::new(&s.env);
    for _cycle in 0..3u32 {
    s.fund_cycle(&group_id, &members);
        let recipient = s.client.next_recipient(&group_id);
        received.push_back(recipient);
        s.end_cycle();
        s.client.trigger_payout(&group_id);
    }

    // Each member received exactly once (invariant #4): recipients == members.
    assert_eq!(received.len(), 3);
    for m in members.iter() {
        assert!(received.contains(&m));
    }
    // Group completed.
    assert_eq!(s.client.get_group(&group_id).status, Status::Completed);
}

// ---- Invariant guards (expect panics/reverts) ----

#[test]
#[should_panic]
fn double_contribute_same_cycle_reverts() {
    let s = setup();
    let amount = 10_000_000i128;
    let (group_id, _organizer, members) = active_group(&s, 2, amount, 0);
    // Must be a member who OWES this cycle — the recipient is exempt and would
    // revert with RecipientExempt instead of AlreadyContributed.
    let recipient = s.client.next_recipient(&group_id);
    let payer = members.iter().find(|m| *m != recipient).unwrap();
    s.client.contribute(&group_id, &payer);
    // Second contribution same cycle must revert (invariant #2).
    s.client.contribute(&group_id, &payer);
}

#[test]
#[should_panic]
fn payout_reverts_when_not_all_contributed() {
    let s = setup();
    let amount = 10_000_000i128;
    let (group_id, organizer, _m) = active_group(&s, 3, amount, 0);
    // Only the organizer pays.
    s.pay_if_owed(&group_id, &organizer);
    // Strict rule: payout must revert (invariant #3).
    s.end_cycle();
    s.client.trigger_payout(&group_id);
}

#[test]
#[should_panic]
fn non_member_cannot_contribute() {
    let s = setup();
    let amount = 10_000_000i128;
    let (group_id, _org, _m) = active_group(&s, 2, amount, 0);
    let stranger = s.funded_member(amount * 10);
    // Wallet-binding: a non-member address reverts (invariant #8).
    s.pay_if_owed(&group_id, &stranger);
}

#[test]
#[should_panic]
fn start_cycle_requires_two_members() {
    let s = setup();
    let amount = 10_000_000i128;
    let organizer = s.funded_member(amount);
    let group_id = s.client.create_group(
        &organizer, &s.token, &amount, &604_800, &0,
        &0u32, &0u64, &PayoutOrder::Manual, &LatePenalty::DeductFromBalance,
    );
    // Only one member -> revert (TooFewMembers).
    s.client.start_cycle(&group_id);
}

// ---- Fund isolation across groups (invariant #1) ----

#[test]
fn two_groups_pools_never_cross() {
    let s = setup();
    let amount_a = 10_000_000i128;
    let amount_b = 7_000_000i128;

    let (group_a, org_a, members_a) = active_group(&s, 2, amount_a, 0);
    let (group_b, _org_b, members_b) = active_group(&s, 2, amount_b, 0);

    // Both groups' funds live in ONE contract token balance, so comparing the
    // per-group Pool integers is not enough — assert against the real balance.
    let check = |s: &Setup| {
        let held = s.token_client.balance(&s.client.address);
        let mut owed = s.client.get_pool(&group_a) + s.client.get_pool(&group_b);
        for m in members_a.iter() {
            owed += s.client.claimable_of(&group_a, &m);
        }
        for m in members_b.iter() {
            owed += s.client.claimable_of(&group_b, &m);
        }
        assert!(held >= owed, "INSOLVENT: holds {held}, owes {owed}");
    };

    // Only group A contributes.
    for m in members_a.iter() {
        s.pay_if_owed(&group_a, &m);
    }

    assert_eq!(s.client.get_pool(&group_a), amount_a); // recipient exempt
    assert_eq!(s.client.get_pool(&group_b), 0);
    check(&s);

    // Paying out A must not touch B's (empty) pool.
    s.end_cycle();
    s.client.trigger_payout(&group_a);
    assert_eq!(s.client.get_pool(&group_a), 0);
    assert_eq!(s.client.get_pool(&group_b), 0);
    check(&s);

    // A's recipient claims; B's escrow must be untouched and still solvent.
    let recipient_a = members_a.get(0).unwrap();
    s.client.claim_payout(&group_a, &recipient_a, &recipient_a);
    check(&s);
    let _ = org_a;
}

// ---- Fee edges ----

// ---- New rule fields (late fee / grace / payout order) ----

#[test]
fn create_group_stores_rule_fields() {
    let s = setup();
    let amount = 10_000_000i128;
    let organizer = s.funded_member(amount);
    let group_id = s.client.create_group(
        &organizer, &s.token, &amount, &604_800, &50,
        &200u32, &3_600u64, &PayoutOrder::Random, &LatePenalty::RemoveMember,
    );

    let cfg = s.client.get_group(&group_id);
    assert_eq!(cfg.late_fee_bps, 200);
    assert_eq!(cfg.grace_period, 3_600);
    assert_eq!(cfg.payout_order, PayoutOrder::Random);
    assert_eq!(cfg.late_penalty, LatePenalty::RemoveMember);
    assert_eq!(cfg.fee_bps, 50);
}

#[test]
#[should_panic]
fn create_group_rejects_late_fee_over_100_percent() {
    let s = setup();
    let amount = 10_000_000i128;
    let organizer = s.funded_member(amount);
    // late_fee_bps > 10000 must revert (InvalidFee).
    s.client.create_group(
        &organizer, &s.token, &amount, &604_800, &0,
        &10_001u32, &0u64, &PayoutOrder::Manual, &LatePenalty::DeductFromBalance,
    );
}

#[test]
#[should_panic]
fn create_group_rejects_zero_cycle_length() {
    let s = setup();
    let amount = 10_000_000i128;
    let organizer = s.funded_member(amount);
    // cycle_length == 0 must revert (InvalidCycleLength).
    s.client.create_group(
        &organizer, &s.token, &amount, &0, &0,
        &0u32, &0u64, &PayoutOrder::Manual, &LatePenalty::DeductFromBalance,
    );
}

#[test]
fn create_group_rejects_zero_cycle_length_typed_error() {
    let s = setup();
    let amount = 10_000_000i128;
    let organizer = s.funded_member(amount);
    // The `try_` variant surfaces the typed error without panicking.
    let res = s.client.try_create_group(
        &organizer, &s.token, &amount, &0, &0,
        &0u32, &0u64, &PayoutOrder::Manual, &LatePenalty::DeductFromBalance,
    );
    assert_eq!(res, Err(Ok(Error::InvalidCycleLength)));
}

// ---- Manual payout order (drag-and-drop "who gets paid first") ----

#[test]
fn set_payout_order_changes_who_is_paid_first() {
    let s = setup();
    let amount = 10_000_000i128;

    // Build an Open group of 3 (organizer + 2) but DON'T start the cycle yet.
    let organizer = s.funded_member(amount * 10);
    let group_id = s.client.create_group(
        &organizer, &s.token, &amount, &604_800, &0,
        &0u32, &0u64, &PayoutOrder::Manual, &LatePenalty::DeductFromBalance,
    );
    let m2 = s.funded_member(amount * 10);
    let m3 = s.funded_member(amount * 10);
    s.client.join_group(&group_id, &m2);
    s.client.join_group(&group_id, &m3);

    // Default order pays the organizer first (index 0). Reorder so m3 is first.
    let mut order = soroban_sdk::Vec::new(&s.env);
    order.push_back(m3.clone());
    order.push_back(organizer.clone());
    order.push_back(m2.clone());
    s.client.set_payout_order(&group_id, &order);

    s.client.start_cycle(&group_id);

    // First cycle's recipient is now m3.
    assert_eq!(s.client.next_recipient(&group_id), m3);
}

#[test]
fn set_payout_order_rejects_non_permutation() {
    let s = setup();
    let amount = 10_000_000i128;
    let organizer = s.funded_member(amount * 10);
    let group_id = s.client.create_group(
        &organizer, &s.token, &amount, &604_800, &0,
        &0u32, &0u64, &PayoutOrder::Manual, &LatePenalty::DeductFromBalance,
    );
    let m2 = s.funded_member(amount * 10);
    s.client.join_group(&group_id, &m2);

    // A stranger is not a member — must revert (InvalidOrder).
    let stranger = s.funded_member(amount);
    let mut bad = soroban_sdk::Vec::new(&s.env);
    bad.push_back(organizer.clone());
    bad.push_back(stranger);
    let res = s.client.try_set_payout_order(&group_id, &bad);
    assert_eq!(res, Err(Ok(Error::InvalidOrder)));
}

#[test]
fn set_payout_order_rejects_when_not_manual() {
    let s = setup();
    let amount = 10_000_000i128;
    let organizer = s.funded_member(amount * 10);
    // Random policy: explicit manual order does not apply.
    let group_id = s.client.create_group(
        &organizer, &s.token, &amount, &604_800, &0,
        &0u32, &0u64, &PayoutOrder::Random, &LatePenalty::DeductFromBalance,
    );
    let m2 = s.funded_member(amount * 10);
    s.client.join_group(&group_id, &m2);

    let mut order = soroban_sdk::Vec::new(&s.env);
    order.push_back(m2.clone());
    order.push_back(organizer.clone());
    let res = s.client.try_set_payout_order(&group_id, &order);
    assert_eq!(res, Err(Ok(Error::OrderNotManual)));
}

// ---- Default handling: resolve_default (H1) ----

/// Push the ledger clock far enough past the grace deadline that a member who
/// hasn't paid the current cycle is eligible for resolve_default.
fn advance_past_grace(s: &Setup) {
    // active_group uses cycle_length = 604_800s; grace_period is 0 in helpers,
    // so any time strictly past cycle_length works. Jump a full extra cycle.
    let now = s.env.ledger().timestamp();
    s.env.ledger().set_timestamp(now + 604_800 + 1);
}

/// A member who has ALREADY been paid must not be refunded when they default.
///
/// Their contributions have already rotated back to them, so there is nothing
/// left to refund — the pool now holds other members' money. Without this
/// guard, defaulting after your payout is a way to take a second one out of
/// everyone else's contributions.
#[test]
fn defaulting_after_being_paid_refunds_nothing() {
    let s = setup();
    let amount = 10_000_000i128;
    // 3 members, no fee, RemoveMember policy so a default always removes.
    let organizer = s.funded_member(amount * 10);
    let group_id = s.client.create_group(
        &organizer, &s.token, &amount, &604_800, &0,
        &0u32, &0u64, &PayoutOrder::Manual, &LatePenalty::RemoveMember,
    );
    let m2 = s.funded_member(amount * 10);
    let m3 = s.funded_member(amount * 10);
    s.client.join_group(&group_id, &m2);
    s.client.join_group(&group_id, &m3);
    s.client.start_cycle(&group_id);

    let all = [organizer.clone(), m2.clone(), m3.clone()];

    // Cycle 0: everyone pays; the organizer is paid first and claims it.
    s.pay_if_owed(&group_id, &organizer);
    s.pay_if_owed(&group_id, &m2);
    s.pay_if_owed(&group_id, &m3);
    s.end_cycle();
    s.client.trigger_payout(&group_id);
    s.client.claim_payout(&group_id, &organizer, &organizer);
    s.assert_solvent(&[(group_id, &all)]);

    // Cycle 1: m2 is the recipient and therefore exempt, and the organizer is
    // the one about to default — so m3 alone funds this pot. It is m3's money.
    s.pay_if_owed(&group_id, &m2);
    s.pay_if_owed(&group_id, &m3);
    let pool_before = s.client.get_pool(&group_id);
    assert_eq!(pool_before, amount);

    // The organizer — already paid — now defaults.
    let org_before = s.token_client.balance(&organizer);
    advance_past_grace(&s);
    s.client.resolve_default(&group_id, &organizer);

    // They must receive NOTHING: their contribution already came back to them
    // as their payout. A refund here would be taken from m2 and m3.
    assert_eq!(
        s.token_client.balance(&organizer),
        org_before,
        "an already-paid member was refunded out of other members' pool",
    );
    assert_eq!(
        s.client.get_pool(&group_id),
        pool_before,
        "the pool was drained to refund an already-paid member",
    );
    s.assert_solvent(&[(group_id, &all)]);

    // m2 still receives the full pool that was funded for them.
    s.end_cycle();
    s.client.trigger_payout(&group_id);
    assert_eq!(s.client.claimable_of(&group_id, &m2), amount);
    s.assert_solvent(&[(group_id, &all)]);
}

/// A refund must never be taken out of money that funds the NEXT payout.
///
/// The pool at any moment belongs to whoever paid into the current cycle. If a
/// defaulter's refund is drawn from it, the next recipient is short-changed by
/// exactly that amount.
#[test]
fn refund_does_not_short_change_the_next_recipient() {
    let s = setup();
    let amount = 10_000_000i128;
    let organizer = s.funded_member(amount * 10);
    let group_id = s.client.create_group(
        &organizer, &s.token, &amount, &604_800, &0,
        &0u32, &0u64, &PayoutOrder::Manual, &LatePenalty::RemoveMember,
    );
    let m2 = s.funded_member(amount * 10);
    let m3 = s.funded_member(amount * 10);
    let m4 = s.funded_member(amount * 10);
    s.client.join_group(&group_id, &m2);
    s.client.join_group(&group_id, &m3);
    s.client.join_group(&group_id, &m4);
    s.client.start_cycle(&group_id);

    let all = [organizer.clone(), m2.clone(), m3.clone(), m4.clone()];

    // Cycle 0: everyone who owes pays (the organizer is the recipient and is
    // exempt), then the organizer is paid out.
    for m in all.iter() {
        s.pay_if_owed(&group_id, m);
    }
    s.end_cycle();
    s.client.trigger_payout(&group_id);
    s.assert_solvent(&[(group_id, &all)]);

    // Cycle 1: m2 is the recipient and exempt; the organizer keeps contributing
    // even though they were already paid; m4 goes silent and is removed. So the
    // organizer and m3 fund this pot.
    s.pay_if_owed(&group_id, &organizer);
    s.pay_if_owed(&group_id, &m2);
    s.pay_if_owed(&group_id, &m3);
    advance_past_grace(&s);
    s.client.resolve_default(&group_id, &m4);
    s.assert_solvent(&[(group_id, &all)]);

    // Two members funded this cycle, so m2 must receive the full 2×amount —
    // not a pool reduced by a refund to m4.
    s.end_cycle();
    s.client.trigger_payout(&group_id);
    assert_eq!(
        s.client.claimable_of(&group_id, &m2),
        amount * 2,
        "next recipient was short-changed to fund a defaulter's refund",
    );
    s.assert_solvent(&[(group_id, &all)]);
}

/// Claiming to the contract's own address would clear the claim while the
/// tokens never move — destroying the payout with no way to recover it.
#[test]
fn claim_to_the_contract_itself_is_rejected() {
    let s = setup();
    let amount = 10_000_000i128;
    let (group_id, _org, members) = active_group(&s, 2, amount, 0);
    s.fund_cycle(&group_id, &members);
    let recipient = s.client.next_recipient(&group_id);
    s.end_cycle();
    s.client.trigger_payout(&group_id);

    let contract_addr = s.client.address.clone();
    let res = s.client.try_claim_payout(&group_id, &recipient, &contract_addr);
    assert!(res.is_err(), "claiming to the contract address must be rejected");

    // The payout is untouched and still claimable.
    assert_eq!(s.client.claimable_of(&group_id, &recipient), amount);
}

/// The late fee must accrue at most once per cycle. Otherwise an organizer can
/// call `resolve_default` in a loop to run a member's debt past their entire
/// payout and redirect it to themselves — bypassing the MAX_FEE_BPS cap.
#[test]
fn late_fee_accrues_only_once_per_cycle() {
    let s = setup();
    let amount = 10_000_000i128;
    let late_bps = 1_000u32; // 10%
    let organizer = s.funded_member(amount * 10);
    let group_id = s.client.create_group(
        &organizer, &s.token, &amount, &604_800, &0,
        &late_bps, &0u64, &PayoutOrder::Manual, &LatePenalty::DeductFromBalance,
    );
    let m2 = s.funded_member(amount * 10);
    s.client.join_group(&group_id, &m2);
    s.client.start_cycle(&group_id);

    // organizer pays; m2 does not and goes past grace.
    s.pay_if_owed(&group_id, &organizer);
    advance_past_grace(&s);

    let expected = amount * late_bps as i128 / 10_000;
    s.client.resolve_default(&group_id, &m2);
    assert_eq!(s.client.late_fee_of(&group_id, &m2), expected);

    // Hammering it must not stack more debt for the same cycle.
    for _ in 0..10 {
        let _ = s.client.try_resolve_default(&group_id, &m2);
    }
    assert_eq!(
        s.client.late_fee_of(&group_id, &m2),
        expected,
        "late fee re-accrued within one cycle — organizer can confiscate the payout",
    );
}

#[test]
fn resolve_default_removes_empty_wallet_member_and_refunds_the_rest() {
    let s = setup();
    let amount = 10_000_000i128;
    // 3 members. m3 will be the defaulter.
    let (group_id, organizer, members) = active_group(&s, 3, amount, 0);
    let m2 = members.get(1).unwrap();
    let m3 = members.get(2).unwrap();

    // organizer + m2 pay cycle 0; m3 does not.
    s.pay_if_owed(&group_id, &organizer);
    s.pay_if_owed(&group_id, &m2);

    // Drain m3's wallet so they "cannot cover" → forced removal path.
    let m3_bal = s.token_client.balance(&m3);
    s.token_client.transfer(&m3, &organizer, &m3_bal);

    advance_past_grace(&s);

    // Pool holds 1 contribution before removal (3 members, one is the exempt
    // recipient, one is the silent member about to be removed).
    assert_eq!(s.client.get_pool(&group_id), amount);

    s.client.resolve_default(&group_id, &m3);

    // m3 is removed; they had paid nothing this run, so no refund, pool intact.
    assert!(s.client.is_removed(&group_id, &m3));
    assert_eq!(s.client.get_pool(&group_id), amount);

    // The circle can now complete with the two remaining members: payout #1 to
    // organizer, then contribute again + payout #2 to m2.
    s.end_cycle();
    s.client.trigger_payout(&group_id); // pays organizer (net = pool)
    // New cycle: the two active members contribute; m3 is skipped.
    s.pay_if_owed(&group_id, &organizer);
    s.pay_if_owed(&group_id, &m2);
    s.end_cycle();
    s.client.trigger_payout(&group_id); // pays m2

    assert_eq!(s.client.get_group(&group_id).status, Status::Completed);
    assert_eq!(s.client.get_pool(&group_id), 0);

    // Pull-based: the two payouts are held as claimable in the contract until the
    // recipients claim. After both claim, the contract's token balance is 0.
    s.client.claim_payout(&group_id, &organizer, &organizer);
    s.client.claim_payout(&group_id, &m2, &m2);
    assert_eq!(s.token_client.balance(&s.client.address), 0);
}

#[test]
fn resolve_default_does_not_refund_already_rotated_contributions() {
    let s = setup();
    let amount = 10_000_000i128;
    // Policy RemoveMember so a member who CAN pay is still removed on default.
    let organizer = s.funded_member(amount * 10);
    let group_id = s.client.create_group(
        &organizer, &s.token, &amount, &604_800, &0,
        &0u32, &0u64, &PayoutOrder::Manual, &LatePenalty::RemoveMember,
    );
    let m2 = s.funded_member(amount * 10);
    let m3 = s.funded_member(amount * 10);
    s.client.join_group(&group_id, &m2);
    s.client.join_group(&group_id, &m3);
    s.client.start_cycle(&group_id);

    // Everyone pays cycle 0; organizer receives cycle-0 payout.
    s.pay_if_owed(&group_id, &organizer);
    s.pay_if_owed(&group_id, &m2);
    s.pay_if_owed(&group_id, &m3);
    s.end_cycle();
    s.client.trigger_payout(&group_id); // organizer paid, cycle → 1

    // Cycle 1: the active members organizer + m2 pay; m3 defaults. m3's cycle-0
    // contribution was ROTATED OUT to the organizer above, so it is no longer in
    // the pool — the pool now holds only the organizer's and m2's cycle-1 money.
    s.pay_if_owed(&group_id, &organizer);
    s.pay_if_owed(&group_id, &m2);
    let m3_before = s.token_client.balance(&m3);
    let pool_before = s.client.get_pool(&group_id);

    advance_past_grace(&s);
    s.client.resolve_default(&group_id, &m3);

    // m3 is removed with NO refund: they have nothing unrotated left. Refunding
    // their spent cycle-0 contribution would pay them out of the organizer's and
    // m2's current-cycle money.
    assert!(s.client.is_removed(&group_id, &m3));
    assert_eq!(s.token_client.balance(&m3), m3_before);
    assert_eq!(s.client.get_pool(&group_id), pool_before);

    // organizer already received in cycle 0, so the two remaining payout slots
    // resolve to m2. With m3 out, the circle completes on the next payout.
    s.end_cycle();
    s.client.trigger_payout(&group_id); // pays m2 (claimable)
    assert_eq!(s.client.get_group(&group_id).status, Status::Completed);

    // m2 receives the full cycle-1 pool, undiminished by m3's removal.
    assert_eq!(s.client.claimable_of(&group_id, &m2), amount);

    // Both cycle payouts are held claimable; once claimed, contract balance is 0.
    s.client.claim_payout(&group_id, &organizer, &organizer);
    s.client.claim_payout(&group_id, &m2, &m2);
    assert_eq!(s.token_client.balance(&s.client.address), 0);
}

#[test]
fn late_fee_is_charged_on_the_debtor_s_next_deposit() {
    let s = setup();
    let amount = 10_000_000i128;
    let late_bps = 1_000u32; // 10% of amount
    // DeductFromBalance policy with funded members, so resolve_default takes the
    // fee path rather than the removal path.
    let organizer = s.funded_member(amount * 10);
    let group_id = s.client.create_group(
        &organizer, &s.token, &amount, &CYCLE_LENGTH, &0,
        &late_bps, &0u64, &PayoutOrder::Manual, &LatePenalty::DeductFromBalance,
    );
    let m2 = s.funded_member(amount * 10);
    let m3 = s.funded_member(amount * 10);
    s.client.join_group(&group_id, &m2);
    s.client.join_group(&group_id, &m3);
    s.client.start_cycle(&group_id);

    // Cycle 0: the organizer is the recipient (exempt). m2 pays; m3 goes silent.
    s.pay_if_owed(&group_id, &m2);

    advance_past_grace(&s);
    s.client.resolve_default(&group_id, &m3);

    let late = amount * late_bps as i128 / 10_000;
    assert_eq!(s.client.late_fee_of(&group_id, &m3), late);
    assert!(!s.client.is_removed(&group_id, &m3), "they could cover it");

    // The debt is visible BEFORE they sign, so the UI can show the real figure.
    assert_eq!(s.client.amount_due(&group_id, &m3), amount + late);
    assert_eq!(s.client.amount_due(&group_id, &m2), amount, "m2 owes no penalty");

    // m3 pays late: the deposit carries the penalty.
    let m3_before = s.token_client.balance(&m3);
    let pool_before = s.client.get_pool(&group_id);
    s.client.contribute(&group_id, &m3);

    assert_eq!(
        s.token_client.balance(&m3),
        m3_before - amount - late,
        "the late fee was not charged on the deposit",
    );
    assert_eq!(
        s.client.get_pool(&group_id),
        pool_before + amount + late,
        "the penalty did not land in the pot",
    );
    assert_eq!(s.client.late_fee_of(&group_id, &m3), 0, "debt not cleared");

    // The delayed cycle's recipient receives it — the party actually harmed.
    let pool = s.client.get_pool(&group_id);
    s.client.trigger_payout(&group_id);
    assert_eq!(
        s.client.claimable_of(&group_id, &organizer),
        pool,
        "the penalty did not reach the recipient whose cycle was delayed",
    );
    assert_eq!(s.client.get_pool(&group_id), 0);

    s.assert_solvent(&[(group_id, &[organizer.clone(), m2.clone(), m3.clone()])]);
}

/// A member who has ALREADY collected their payout can still be penalised.
///
/// This is what netting the fee out of their own payout could never do: once
/// they have received, there is no future payout to deduct from, so the penalty
/// was unenforceable against exactly the member most likely to stop paying.
#[test]
fn an_already_paid_member_still_pays_their_late_fee() {
    let s = setup();
    let amount = 10_000_000i128;
    let late_bps = 1_000u32;
    let organizer = s.funded_member(amount * 10);
    let group_id = s.client.create_group(
        &organizer, &s.token, &amount, &CYCLE_LENGTH, &0,
        &late_bps, &0u64, &PayoutOrder::Manual, &LatePenalty::DeductFromBalance,
    );
    let m2 = s.funded_member(amount * 10);
    let m3 = s.funded_member(amount * 10);
    s.client.join_group(&group_id, &m2);
    s.client.join_group(&group_id, &m3);
    s.client.start_cycle(&group_id);

    // Cycle 0: organizer is the recipient and collects.
    s.pay_if_owed(&group_id, &m2);
    s.pay_if_owed(&group_id, &m3);
    s.client.trigger_payout(&group_id);
    assert!(s.client.claimable_of(&group_id, &organizer) > 0);
    s.open_next_round(&group_id);

    // Cycle 1: the organizer — already paid, with no future payout — goes silent.
    s.pay_if_owed(&group_id, &m3);
    advance_past_grace(&s);
    s.client.resolve_default(&group_id, &organizer);

    let late = amount * late_bps as i128 / 10_000;
    assert_eq!(s.client.late_fee_of(&group_id, &organizer), late);
    assert_eq!(s.client.amount_due(&group_id, &organizer), amount + late);

    // And the penalty is actually collected when they next pay in.
    let before = s.token_client.balance(&organizer);
    s.client.contribute(&group_id, &organizer);
    assert_eq!(
        s.token_client.balance(&organizer),
        before - amount - late,
        "an already-paid member escaped their late fee",
    );

    s.assert_solvent(&[(group_id, &[organizer.clone(), m2.clone(), m3.clone()])]);
}

#[test]
fn resolve_default_rejects_before_grace_deadline() {
    let s = setup();
    let amount = 10_000_000i128;
    let (group_id, organizer, members) = active_group(&s, 3, amount, 0);
    let m3 = members.get(2).unwrap();
    s.pay_if_owed(&group_id, &organizer);
    // No time advance: still within the cycle → not defaultable yet.
    let res = s.client.try_resolve_default(&group_id, &m3);
    assert_eq!(res, Err(Ok(Error::NotDefaultable)));
    let _ = members;
}

#[test]
fn resolve_default_rejects_a_member_who_already_paid() {
    let s = setup();
    let amount = 10_000_000i128;
    let (group_id, organizer, members) = active_group(&s, 3, amount, 0);
    let m2 = members.get(1).unwrap();
    s.pay_if_owed(&group_id, &m2); // m2 paid
    advance_past_grace(&s);
    let res = s.client.try_resolve_default(&group_id, &m2);
    assert_eq!(res, Err(Ok(Error::NotDefaultable)));
    let _ = (organizer, members);
}

#[test]
fn create_group_rejects_service_fee_over_cap() {
    let s = setup();
    let amount = 10_000_000i128;
    let organizer = s.funded_member(amount);
    // fee_bps above the 10% cap must revert (InvalidFee).
    let res = s.client.try_create_group(
        &organizer, &s.token, &amount, &604_800, &1_001u32,
        &0u32, &0u64, &PayoutOrder::Manual, &LatePenalty::DeductFromBalance,
    );
    assert_eq!(res, Err(Ok(Error::InvalidFee)));
}

#[test]
fn zero_fee_gives_whole_pool_to_recipient() {
    let s = setup();
    let amount = 20_000_000i128;
    let (group_id, _org, members) = active_group(&s, 2, amount, 0);
    s.fund_cycle(&group_id, &members);
    let recipient = s.client.next_recipient(&group_id);
    let before = s.token_client.balance(&recipient);
    s.end_cycle();
    s.client.trigger_payout(&group_id);
    // Zero fee → the whole pool is claimable by the recipient (not yet in wallet).
    assert_eq!(s.client.claimable_of(&group_id, &recipient), amount);
    assert_eq!(s.token_client.balance(&recipient), before);
    // After claiming, the whole pool is in their wallet.
    s.client.claim_payout(&group_id, &recipient, &recipient);
    assert_eq!(s.token_client.balance(&recipient), before + amount);
}

// ----------------------------------------------------------------------------
// Completion via removal — regression for the permanent fund lock
// ----------------------------------------------------------------------------

/// Removing the LAST member still awaiting a payout must complete the group and
/// return the open cycle's pool, not strand it.
///
/// Before the fix, `remove_member` marked the removed member `Received` but only
/// `trigger_payout` ever re-checked completion. So a removal that took
/// `remaining_recipients` to zero left the group Active with a funded pool and
/// no reachable recipient: `trigger_payout`'s scan found nobody and returned
/// WrongStatus forever, and with no refund/cancel/sweep the escrow was
/// unrecoverable.
#[test]
fn removing_the_last_unpaid_member_completes_and_returns_the_pool() {
    let s = setup();
    let amount = 10_000_000i128;

    let organizer = s.funded_member(amount * 10);
    let group_id = s.client.create_group(
        &organizer, &s.token, &amount, &604_800, &0,
        &0u32, &0u64, &PayoutOrder::Manual, &LatePenalty::RemoveMember,
    );
    let m2 = s.funded_member(amount * 10);
    s.client.join_group(&group_id, &m2);
    s.client.start_cycle(&group_id);

    // Cycle 0: both pay, organizer (first in rotation) is paid.
    s.pay_if_owed(&group_id, &organizer);
    s.pay_if_owed(&group_id, &m2);
    s.end_cycle();
    s.client.trigger_payout(&group_id);
    assert_eq!(s.client.get_pool(&group_id), 0);

    // Claim that payout now, so the balance asserted at the end is purely the
    // returned residual and not cycle 0's earnings sitting unclaimed.
    s.client.claim_payout(&group_id, &organizer, &organizer);
    assert_eq!(s.client.claimable_of(&group_id, &organizer), 0);

    // Cycle 1: only the organizer pays. m2 — the sole remaining recipient —
    // goes silent, so the pool holds exactly the organizer's contribution.
    s.pay_if_owed(&group_id, &organizer);
    assert_eq!(s.client.get_pool(&group_id), amount);

    // Push past cycle_length + grace so m2 is defaultable.
    s.env.ledger().set_timestamp(s.env.ledger().timestamp() + 604_800 + 1);
    s.client.resolve_default(&group_id, &m2);

    // The group must now be Completed rather than stuck Active.
    assert_eq!(
        s.client.get_group(&group_id).status,
        Status::Completed,
        "removal emptied the rotation but the group stayed Active",
    );

    // And the stranded pool must have been returned to the member who funded
    // it — as a claimable balance, not pushed.
    assert_eq!(s.client.get_pool(&group_id), 0, "pool was left stranded");
    assert_eq!(
        s.client.claimable_of(&group_id, &organizer),
        amount,
        "the open cycle's contribution was not returned to its funder",
    );

    s.assert_solvent(&[(group_id, &[organizer.clone(), m2.clone()])]);

    // It is really withdrawable, not just recorded.
    let before = s.token_client.balance(&organizer);
    s.client.claim_payout(&group_id, &organizer, &organizer);
    assert_eq!(s.token_client.balance(&organizer), before + amount);
}

// ----------------------------------------------------------------------------
// Cycle timing floor
// ----------------------------------------------------------------------------

/// A cycle pays out as soon as everyone who OWES has paid — but the next
/// round's deposits stay shut until the cycle boundary.
///
/// The schedule lives on the deposit window, not the payout. Making the
/// recipient wait for a boundary would just park settled money in escrow; what
/// must not happen is the NEXT round opening early, because that is what would
/// let a "monthly" circle run every cycle back-to-back in an afternoon.
#[test]
fn payout_is_immediate_but_the_next_round_waits_for_the_schedule() {
    let s = setup();
    let amount = 10_000_000i128;
    let (group_id, _organizer, members) = active_group(&s, 3, amount, 0);

    let recipient = s.client.next_recipient(&group_id);

    // Everyone except the recipient funds the pot.
    for m in members.iter() {
        if m != recipient {
            s.pay_if_owed(&group_id, &m);
        }
    }

    // Pot is (n - 1) * amount: the recipient does not pay into their own payout.
    assert_eq!(s.client.get_pool(&group_id), amount * 2);

    // No waiting — it settles right now.
    s.client.trigger_payout(&group_id);
    assert_eq!(s.client.get_cycle(&group_id), 1);
    assert_eq!(s.client.claimable_of(&group_id, &recipient), amount * 2);

    // But the next round has NOT opened yet.
    let next = s.client.next_recipient(&group_id);
    let payer = members.iter().find(|m| *m != next).unwrap();
    assert_eq!(
        s.client.try_contribute(&group_id, &payer),
        Err(Ok(Error::CycleNotOpen)),
        "next round's deposits opened before the cycle boundary",
    );

    // Once the boundary passes it opens normally.
    s.env
        .ledger()
        .set_timestamp(s.client.deposits_open_at(&group_id));
    s.pay_if_owed(&group_id, &payer);
    assert_eq!(s.client.get_pool(&group_id), amount);
}

/// The member due to collect this cycle cannot pay into their own pot.
#[test]
fn the_current_recipient_is_exempt_from_contributing() {
    let s = setup();
    let amount = 10_000_000i128;
    let (group_id, _organizer, _members) = active_group(&s, 3, amount, 0);

    let recipient = s.client.next_recipient(&group_id);

    assert_eq!(
        s.client.try_contribute(&group_id, &recipient),
        Err(Ok(Error::RecipientExempt)),
    );
    assert_eq!(s.client.get_pool(&group_id), 0);
}

/// Over a full rotation every member pays the same total and receives the same
/// total, so exempting the recipient is net-neutral — it just removes a
/// round-trip where they funded their own payout.
#[test]
fn a_full_rotation_is_net_neutral_for_everyone() {
    let s = setup();
    let amount = 10_000_000i128;
    let n = 4u32;
    let (group_id, _organizer, members) = active_group(&s, n, amount, 0);

    let mut before = soroban_sdk::Vec::new(&s.env);
    for m in members.iter() {
        before.push_back(s.token_client.balance(&m));
    }

    for _ in 0..n {
        let recipient = s.client.next_recipient(&group_id);
        for m in members.iter() {
            if m != recipient {
                s.pay_if_owed(&group_id, &m);
            }
        }
        s.client.trigger_payout(&group_id);
        s.client.claim_payout(&group_id, &recipient, &recipient);
        // Open the next round.
        s.env
            .ledger()
            .set_timestamp(s.client.deposits_open_at(&group_id) + 1);
    }

    for (i, m) in members.iter().enumerate() {
        assert_eq!(
            s.token_client.balance(&m),
            before.get(i as u32).unwrap(),
            "member {i} did not come out even over a full rotation",
        );
    }
    assert_eq!(s.client.get_pool(&group_id), 0);
}

// ----------------------------------------------------------------------------
// resolve_default escalation
// ----------------------------------------------------------------------------

/// Within the escalation window a default is the organizer's call; after it,
/// any member may resolve it so an absent organizer cannot freeze the circle.
#[test]
fn any_member_may_resolve_a_default_after_the_escalation_window() {
    let s = setup();
    let amount = 10_000_000i128;

    // RemoveMember, so a resolved default is observable via `is_removed`.
    // The helper groups use DeductFromBalance, where a funded member is merely
    // charged a fee and stays in the circle.
    let organizer = s.funded_member(amount * 10);
    let group_id = s.client.create_group(
        &organizer, &s.token, &amount, &CYCLE_LENGTH, &0,
        &0u32, &0u64, &PayoutOrder::Manual, &LatePenalty::RemoveMember,
    );
    let m2 = s.funded_member(amount * 10);
    let slacker = s.funded_member(amount * 10);
    s.client.join_group(&group_id, &m2);
    s.client.join_group(&group_id, &slacker);
    s.client.start_cycle(&group_id);

    s.pay_if_owed(&group_id, &organizer);
    s.pay_if_owed(&group_id, &m2);

    // Past the deadline. `mock_all_auths` means we cannot assert WHO signed,
    // so what this pins down is the TIMING rule: the default becomes
    // resolvable once the deadline passes and stays resolvable after the
    // organizer's exclusive window closes — which is what stops an absent
    // organizer from freezing everyone else's escrow indefinitely.
    let now = s.env.ledger().timestamp();
    s.env.ledger().set_timestamp(now + CYCLE_LENGTH + DEFAULT_ESCALATION_WINDOW + 1);

    s.client.resolve_default(&group_id, &slacker);
    assert!(s.client.is_removed(&group_id, &slacker));

    // With the defaulter out, the remaining two complete the cycle normally.
    s.client.trigger_payout(&group_id);
    assert_eq!(s.client.get_cycle(&group_id), 1);

    s.assert_solvent(&[(group_id, &[organizer.clone(), m2.clone(), slacker.clone()])]);
}

/// The escalation window is a real boundary: a default is not resolvable until
/// the deadline, regardless of who calls.
#[test]
fn a_default_is_not_resolvable_before_the_deadline() {
    let s = setup();
    let amount = 10_000_000i128;
    let (group_id, _organizer, members) = active_group(&s, 3, amount, 0);

    let slacker = members.get(2).unwrap();
    s.pay_if_owed(&group_id, &members.get(0).unwrap());

    assert_eq!(
        s.client.try_resolve_default(&group_id, &slacker),
        Err(Ok(Error::NotDefaultable)),
        "a member was defaultable before the cycle even ended",
    );
    assert!(!s.client.is_removed(&group_id, &slacker));
}
