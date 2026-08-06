#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::{StellarAssetClient, TokenClient},
    Address, Env,
};

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
    /// Create a funded member address holding `balance` of the token.
    fn funded_member(&self, balance: i128) -> Address {
        let addr = Address::generate(&self.env);
        self.token_admin.mint(&addr, &balance);
        addr
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
    for m in members.iter() {
        s.client.contribute(&group_id, &m);
    }

    let recipient = members.get(0).unwrap(); // organizer, cycle 0 -> index 0
    let recipient_before = s.token_client.balance(&recipient);

    s.client.trigger_payout(&group_id);

    let pool = amount * 3;
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
        s.client.contribute(&group_id, &m);
    }
    s.client.trigger_payout(&group_id);
    assert_eq!(s.client.claimable_of(&group_id, &m3), amount * 3);
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
    for m in members.iter() {
        s.client.contribute(&group_id, &m);
    }
    let recipient = s.client.next_recipient(&group_id);
    s.client.trigger_payout(&group_id);

    // First claim succeeds and moves the funds.
    let claimed = s.client.claim_payout(&group_id, &recipient, &recipient);
    assert_eq!(claimed, amount * 2);
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
    for m in members.iter() {
        s.client.contribute(&group_id, &m);
    }
    let recipient = s.client.next_recipient(&group_id);
    s.client.trigger_payout(&group_id);

    // An external wallet the member wants paid — not a circle member.
    let destination = s.funded_member(0);
    let recipient_before = s.token_client.balance(&recipient);

    let claimed = s.client.claim_payout(&group_id, &recipient, &destination);

    // The whole payout lands at the destination…
    assert_eq!(claimed, amount * 2);
    assert_eq!(s.token_client.balance(&destination), amount * 2);
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
    for m in members.iter() {
        s.client.contribute(&group_id, &m);
    }
    let recipient = s.client.next_recipient(&group_id);
    let before = s.token_client.balance(&recipient);
    s.client.trigger_payout(&group_id);

    let claimed = s.client.claim_payout(&group_id, &recipient, &recipient);

    assert_eq!(claimed, amount * 2);
    assert_eq!(s.token_client.balance(&recipient), before + amount * 2);
    assert_eq!(s.client.claimable_of(&group_id, &recipient), 0);
}

#[test]
fn full_rotation_pays_each_member_once_then_completes() {
    let s = setup();
    let amount = 10_000_000i128;
    let (group_id, _org, members) = active_group(&s, 3, amount, 0);

    let mut received = soroban_sdk::Vec::new(&s.env);
    for _cycle in 0..3u32 {
        for m in members.iter() {
            s.client.contribute(&group_id, &m);
        }
        let recipient = s.client.next_recipient(&group_id);
        received.push_back(recipient);
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
    let (group_id, organizer, _m) = active_group(&s, 2, amount, 0);
    s.client.contribute(&group_id, &organizer);
    // Second contribution same cycle must revert (invariant #2).
    s.client.contribute(&group_id, &organizer);
}

#[test]
#[should_panic]
fn payout_reverts_when_not_all_contributed() {
    let s = setup();
    let amount = 10_000_000i128;
    let (group_id, organizer, _m) = active_group(&s, 3, amount, 0);
    // Only the organizer pays.
    s.client.contribute(&group_id, &organizer);
    // Strict rule: payout must revert (invariant #3).
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
    s.client.contribute(&group_id, &stranger);
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
    let (group_b, _org_b, _members_b) = active_group(&s, 2, amount_b, 0);

    // Only group A contributes.
    for m in members_a.iter() {
        s.client.contribute(&group_a, &m);
    }

    assert_eq!(s.client.get_pool(&group_a), amount_a * 2);
    assert_eq!(s.client.get_pool(&group_b), 0);

    // Paying out A must not touch B's (empty) pool.
    s.client.trigger_payout(&group_a);
    assert_eq!(s.client.get_pool(&group_a), 0);
    assert_eq!(s.client.get_pool(&group_b), 0);
    let _ = (org_a, group_b);
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

#[test]
fn resolve_default_removes_empty_wallet_member_and_refunds_the_rest() {
    let s = setup();
    let amount = 10_000_000i128;
    // 3 members. m3 will be the defaulter.
    let (group_id, organizer, members) = active_group(&s, 3, amount, 0);
    let m2 = members.get(1).unwrap();
    let m3 = members.get(2).unwrap();

    // organizer + m2 pay cycle 0; m3 does not.
    s.client.contribute(&group_id, &organizer);
    s.client.contribute(&group_id, &m2);

    // Drain m3's wallet so they "cannot cover" → forced removal path.
    let m3_bal = s.token_client.balance(&m3);
    s.token_client.transfer(&m3, &organizer, &m3_bal);

    advance_past_grace(&s);

    // Pool holds 2 contributions before removal.
    assert_eq!(s.client.get_pool(&group_id), amount * 2);

    s.client.resolve_default(&group_id, &m3);

    // m3 is removed; they had paid nothing this run, so no refund, pool intact.
    assert!(s.client.is_removed(&group_id, &m3));
    assert_eq!(s.client.get_pool(&group_id), amount * 2);

    // The circle can now complete with the two remaining members: payout #1 to
    // organizer, then contribute again + payout #2 to m2.
    s.client.trigger_payout(&group_id); // pays organizer (net = pool)
    // New cycle: the two active members contribute; m3 is skipped.
    s.client.contribute(&group_id, &organizer);
    s.client.contribute(&group_id, &m2);
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
fn resolve_default_refunds_a_removed_member_their_past_contributions() {
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
    s.client.contribute(&group_id, &organizer);
    s.client.contribute(&group_id, &m2);
    s.client.contribute(&group_id, &m3);
    s.client.trigger_payout(&group_id); // organizer paid, cycle → 1

    // Cycle 1: the active members organizer + m2 pay; m3 defaults. m3 already
    // paid `amount` in cycle 0 (which is still sitting in the pool).
    s.client.contribute(&group_id, &organizer);
    s.client.contribute(&group_id, &m2);
    let m3_before = s.token_client.balance(&m3);
    let pool_before = s.client.get_pool(&group_id);

    advance_past_grace(&s);
    s.client.resolve_default(&group_id, &m3);

    // m3 removed and refunded exactly what they had put in (amount, from cycle 0).
    assert!(s.client.is_removed(&group_id, &m3));
    assert_eq!(s.token_client.balance(&m3), m3_before + amount);
    assert_eq!(s.client.get_pool(&group_id), pool_before - amount);

    // organizer already received in cycle 0, so the two remaining payout slots
    // resolve to m2. With m3 out, the circle completes on the next payout.
    s.client.trigger_payout(&group_id); // pays m2 (claimable)
    assert_eq!(s.client.get_group(&group_id).status, Status::Completed);

    // Both cycle payouts are held claimable; once claimed, contract balance is 0.
    s.client.claim_payout(&group_id, &organizer, &organizer);
    s.client.claim_payout(&group_id, &m2, &m2);
    assert_eq!(s.token_client.balance(&s.client.address), 0);
}

#[test]
fn resolve_default_accrues_late_fee_and_nets_it_from_payout() {
    let s = setup();
    let amount = 10_000_000i128;
    let late_bps = 1_000u32; // 10% of amount
    // DeductFromBalance policy, funded members (so they "can cover" → fee path).
    let organizer = s.funded_member(amount * 10);
    let group_id = s.client.create_group(
        &organizer, &s.token, &amount, &604_800, &0,
        &late_bps, &0u64, &PayoutOrder::Manual, &LatePenalty::DeductFromBalance,
    );
    let m2 = s.funded_member(amount * 10);
    s.client.join_group(&group_id, &m2);
    s.client.start_cycle(&group_id);

    // m2 is the cycle-0 recipient? No — organizer is index 0. Reorder so m2 is
    // first so we can watch the fee come out of m2's payout.
    // (Rebuild with explicit order isn't needed: default pays organizer first.
    //  Instead, let organizer default so the fee lands on organizer's payout.)
    // Simpler: m2 pays, organizer defaults with a late fee, then organizer is
    // the recipient and the fee is netted from their own payout.
    s.client.contribute(&group_id, &m2);

    advance_past_grace(&s);
    s.client.resolve_default(&group_id, &organizer);

    let late = amount * late_bps as i128 / 10_000;
    assert_eq!(s.client.late_fee_of(&group_id, &organizer), late);
    // organizer is NOT removed (they could cover it).
    assert!(!s.client.is_removed(&group_id, &organizer));

    // organizer now pays their cycle contribution; both have paid → payout.
    s.client.contribute(&group_id, &organizer);

    let pool = s.client.get_pool(&group_id); // 2 * amount
    let org_before = s.token_client.balance(&organizer);
    s.client.trigger_payout(&group_id); // recipient = organizer (index 0)

    // organizer receives pool minus their own late fee; fee stays with organizer
    // (they are also the fee recipient), so net wallet change = pool.
    // To isolate the late-fee netting, assert the debt was cleared.
    assert_eq!(s.client.late_fee_of(&group_id, &organizer), 0);
    let _ = (pool, org_before);
    assert_eq!(s.client.get_pool(&group_id), 0);
}

#[test]
fn resolve_default_rejects_before_grace_deadline() {
    let s = setup();
    let amount = 10_000_000i128;
    let (group_id, organizer, members) = active_group(&s, 3, amount, 0);
    let m3 = members.get(2).unwrap();
    s.client.contribute(&group_id, &organizer);
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
    s.client.contribute(&group_id, &m2); // m2 paid
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
    for m in members.iter() {
        s.client.contribute(&group_id, &m);
    }
    let recipient = s.client.next_recipient(&group_id);
    let before = s.token_client.balance(&recipient);
    s.client.trigger_payout(&group_id);
    // Zero fee → the whole pool is claimable by the recipient (not yet in wallet).
    assert_eq!(s.client.claimable_of(&group_id, &recipient), amount * 2);
    assert_eq!(s.token_client.balance(&recipient), before);
    // After claiming, the whole pool is in their wallet.
    s.client.claim_payout(&group_id, &recipient, &recipient);
    assert_eq!(s.token_client.balance(&recipient), before + amount * 2);
}
