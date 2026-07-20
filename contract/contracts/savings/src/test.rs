#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::Address as _,
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
    let group_id = s.client.create_group(&organizer, &s.token, &amount, &604_800, &fee_bps);

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
    let (group_id, organizer, members) = active_group(&s, 3, amount, fee_bps);

    // Everyone contributes cycle 0.
    for m in members.iter() {
        s.client.contribute(&group_id, &m);
    }

    let recipient = members.get(0).unwrap(); // organizer, cycle 0 -> index 0
    let recipient_before = s.token_client.balance(&recipient);
    let organizer_fee_before = s.token_client.balance(&organizer);

    s.client.trigger_payout(&group_id);

    let pool = amount * 3;
    let fee = pool * fee_bps as i128 / 10_000;
    let net = pool - fee;

    // Recipient is also the organizer here, so they receive net + fee.
    assert_eq!(s.token_client.balance(&recipient), recipient_before + net + fee);
    let _ = organizer_fee_before;

    // Pool emptied (invariant #5).
    assert_eq!(s.client.get_pool(&group_id), 0);
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
    let group_id = s.client.create_group(&organizer, &s.token, &amount, &604_800, &0);
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
    assert_eq!(s.token_client.balance(&recipient), before + amount * 2);
}
