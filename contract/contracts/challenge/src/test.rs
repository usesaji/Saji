#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::Address as _,
    token::{StellarAssetClient, TokenClient},
    Address, Env,
};

/// Test harness: the contract, a mock token, and helpers to mint/register.
struct Setup {
    env: Env,
    client: ChallengeContractClient<'static>,
    token: Address,
    token_admin: StellarAssetClient<'static>,
    token_client: TokenClient<'static>,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(ChallengeContract, ());
    let client = ChallengeContractClient::new(&env, &contract_id);

    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer);
    let token = sac.address();
    let token_admin = StellarAssetClient::new(&env, &token);
    let token_client = TokenClient::new(&env, &token);

    Setup { env, client, token, token_admin, token_client }
}

impl Setup {
    /// A funded member address holding `balance` of the token.
    fn funded_member(&self, balance: i128) -> Address {
        let addr = Address::generate(&self.env);
        self.token_admin.mint(&addr, &balance);
        addr
    }

    /// THE solvency invariant: the contract's real token balance must always
    /// cover the sum of every member's recorded balance.
    ///
    /// All challenges share ONE token balance, so per-challenge bookkeeping
    /// that drifts above reality silently spends another challenge's escrow.
    /// Assert this after every money-moving operation; it is the single check
    /// that catches over-crediting, double-withdrawal, and cross-challenge
    /// leakage.
    fn assert_solvent(&self, challenges: &[(u64, &[Address])]) {
        let held = self.token_client.balance(&self.client.address);
        let mut owed = 0i128;
        for (challenge_id, members) in challenges {
            for m in members.iter() {
                owed += self.client.balance_of(challenge_id, m);
            }
        }
        assert!(
            held >= owed,
            "INSOLVENT: contract holds {held} but owes {owed} (short by {})",
            owed - held,
        );
    }
}

// ----------------------------------------------------------------------------
// Deposit
// ----------------------------------------------------------------------------

#[test]
fn deposit_escrows_funds_and_credits_the_member() {
    let s = setup();
    let ada = s.funded_member(1_000);

    s.client.deposit(&1, &ada, &s.token, &400);

    // The money physically left the member and is held by the contract.
    assert_eq!(s.token_client.balance(&ada), 600);
    assert_eq!(s.token_client.balance(&s.client.address), 400);
    assert_eq!(s.client.balance_of(&1, &ada), 400);
    s.assert_solvent(&[(1, &[ada])]);
}

#[test]
fn deposits_accumulate() {
    let s = setup();
    let ada = s.funded_member(1_000);

    s.client.deposit(&1, &ada, &s.token, &300);
    s.client.deposit(&1, &ada, &s.token, &250);

    assert_eq!(s.client.balance_of(&1, &ada), 550);
    s.assert_solvent(&[(1, &[ada])]);
}

#[test]
fn deposit_rejects_zero_and_negative() {
    let s = setup();
    let ada = s.funded_member(1_000);

    assert_eq!(
        s.client.try_deposit(&1, &ada, &s.token, &0),
        Err(Ok(Error::InvalidAmount)),
    );
    assert_eq!(
        s.client.try_deposit(&1, &ada, &s.token, &-100),
        Err(Ok(Error::InvalidAmount)),
    );
}

#[test]
fn a_challenge_is_locked_to_its_first_token() {
    let s = setup();
    let ada = s.funded_member(1_000);
    s.client.deposit(&1, &ada, &s.token, &100);

    // A second token cannot be mixed into the same challenge — the balance
    // figure would no longer say which asset it refers to.
    let other_issuer = Address::generate(&s.env);
    let other = s.env.register_stellar_asset_contract_v2(other_issuer).address();
    StellarAssetClient::new(&s.env, &other).mint(&ada, &500);

    assert_eq!(
        s.client.try_deposit(&1, &ada, &other, &100),
        Err(Ok(Error::WrongToken)),
    );
    assert_eq!(s.client.token_of(&1), Some(s.token.clone()));
}

// ----------------------------------------------------------------------------
// Withdraw — unconditional by design
// ----------------------------------------------------------------------------

#[test]
fn member_can_withdraw_the_whole_balance_to_their_own_wallet() {
    let s = setup();
    let ada = s.funded_member(1_000);
    s.client.deposit(&1, &ada, &s.token, &400);

    let remaining = s.client.withdraw(&1, &ada, &ada, &400);

    assert_eq!(remaining, 0);
    assert_eq!(s.token_client.balance(&ada), 1_000); // whole deposit returned
    assert_eq!(s.client.balance_of(&1, &ada), 0);
    s.assert_solvent(&[(1, &[ada])]);
}

#[test]
fn member_can_withdraw_part_of_their_balance() {
    let s = setup();
    let ada = s.funded_member(1_000);
    s.client.deposit(&1, &ada, &s.token, &600);

    // Unlike a circle payout, a challenge withdrawal takes an AMOUNT — so a
    // partial withdrawal is one call with no claim-and-forward hop.
    let remaining = s.client.withdraw(&1, &ada, &ada, &250);

    assert_eq!(remaining, 350);
    assert_eq!(s.client.balance_of(&1, &ada), 350);
    assert_eq!(s.token_client.balance(&ada), 650);
    s.assert_solvent(&[(1, &[ada])]);
}

#[test]
fn withdrawal_can_go_to_any_address_the_member_names() {
    let s = setup();
    let ada = s.funded_member(1_000);
    let external_wallet = Address::generate(&s.env);
    s.client.deposit(&1, &ada, &s.token, &500);

    // "Withdraw to my preferred wallet" — the destination need not be the
    // address that deposited.
    s.client.withdraw(&1, &ada, &external_wallet, &500);

    assert_eq!(s.token_client.balance(&external_wallet), 500);
    assert_eq!(s.client.balance_of(&1, &ada), 0);
    s.assert_solvent(&[(1, &[ada])]);
}

#[test]
fn withdrawing_short_of_the_target_is_allowed() {
    let s = setup();
    let ada = s.funded_member(1_000);
    // Target is 500 in the app; the contract neither knows nor cares. Someone
    // who saved 120 and lost interest gets their money back, no penalty.
    s.client.deposit(&1, &ada, &s.token, &120);

    let remaining = s.client.withdraw(&1, &ada, &ada, &120);

    assert_eq!(remaining, 0);
    assert_eq!(s.token_client.balance(&ada), 1_000);
}

#[test]
fn withdraw_rejects_more_than_the_member_holds() {
    let s = setup();
    let ada = s.funded_member(1_000);
    s.client.deposit(&1, &ada, &s.token, &300);

    assert_eq!(
        s.client.try_withdraw(&1, &ada, &ada, &301),
        Err(Ok(Error::InsufficientBalance)),
    );
    assert_eq!(s.client.balance_of(&1, &ada), 300); // untouched
}

#[test]
fn withdraw_with_no_balance_reverts() {
    let s = setup();
    let stranger = s.funded_member(100);

    assert_eq!(
        s.client.try_withdraw(&1, &stranger, &stranger, &1),
        Err(Ok(Error::InsufficientBalance)),
    );
}

#[test]
fn withdraw_rejects_zero_and_negative() {
    let s = setup();
    let ada = s.funded_member(1_000);
    s.client.deposit(&1, &ada, &s.token, &300);

    assert_eq!(
        s.client.try_withdraw(&1, &ada, &ada, &0),
        Err(Ok(Error::InvalidAmount)),
    );
    assert_eq!(
        s.client.try_withdraw(&1, &ada, &ada, &-50),
        Err(Ok(Error::InvalidAmount)),
    );
}

#[test]
fn withdrawing_to_the_contract_itself_is_rejected() {
    let s = setup();
    let ada = s.funded_member(1_000);
    s.client.deposit(&1, &ada, &s.token, &300);

    // Would clear the balance while the tokens never moved.
    assert_eq!(
        s.client.try_withdraw(&1, &ada, &s.client.address, &300),
        Err(Ok(Error::InvalidDestination)),
    );
    assert_eq!(s.client.balance_of(&1, &ada), 300);
}

#[test]
fn double_withdraw_of_the_same_funds_reverts() {
    let s = setup();
    let ada = s.funded_member(1_000);
    s.client.deposit(&1, &ada, &s.token, &400);

    s.client.withdraw(&1, &ada, &ada, &400);
    assert_eq!(
        s.client.try_withdraw(&1, &ada, &ada, &400),
        Err(Ok(Error::InsufficientBalance)),
    );
    assert_eq!(s.token_client.balance(&ada), 1_000); // not 1,400
}

// ----------------------------------------------------------------------------
// Isolation — the reason this is its own contract
// ----------------------------------------------------------------------------

#[test]
fn one_member_cannot_withdraw_anothers_savings() {
    let s = setup();
    let ada = s.funded_member(1_000);
    let ben = s.funded_member(1_000);

    s.client.deposit(&1, &ada, &s.token, &500);
    s.client.deposit(&1, &ben, &s.token, &200);

    // Ben has 200 of his own; the contract holds 700. He may not reach Ada's.
    assert_eq!(
        s.client.try_withdraw(&1, &ben, &ben, &700),
        Err(Ok(Error::InsufficientBalance)),
    );
    assert_eq!(s.client.balance_of(&1, &ada), 500);
    s.assert_solvent(&[(1, &[ada, ben])]);
}

#[test]
fn savings_in_one_challenge_cannot_be_withdrawn_from_another() {
    let s = setup();
    let ada = s.funded_member(1_000);

    s.client.deposit(&1, &ada, &s.token, &500);
    s.client.deposit(&2, &ada, &s.token, &100);

    // Same member, two challenges: challenge 2 holds only 100 of hers, even
    // though the contract's own balance is 600 (invariant #1).
    assert_eq!(s.client.balance_of(&1, &ada), 500);
    assert_eq!(s.client.balance_of(&2, &ada), 100);
    assert_eq!(
        s.client.try_withdraw(&2, &ada, &ada, &600),
        Err(Ok(Error::InsufficientBalance)),
    );
    s.assert_solvent(&[(1, &[ada.clone()]), (2, &[ada])]);
}

#[test]
fn different_challenges_may_use_different_tokens() {
    let s = setup();
    let ada = s.funded_member(1_000);
    s.client.deposit(&1, &ada, &s.token, &300);

    // Challenge 2 has had no deposit yet, so it is free to pick another token.
    let issuer = Address::generate(&s.env);
    let other = s.env.register_stellar_asset_contract_v2(issuer).address();
    StellarAssetClient::new(&s.env, &other).mint(&ada, &500);

    s.client.deposit(&2, &ada, &other, &500);

    assert_eq!(s.client.token_of(&1), Some(s.token.clone()));
    assert_eq!(s.client.token_of(&2), Some(other.clone()));
    assert_eq!(s.client.balance_of(&2, &ada), 500);

    // Each withdraws in its own asset.
    s.client.withdraw(&2, &ada, &ada, &500);
    assert_eq!(TokenClient::new(&s.env, &other).balance(&ada), 500);
    assert_eq!(s.client.balance_of(&1, &ada), 300); // untouched
}

// ----------------------------------------------------------------------------
// Full journey
// ----------------------------------------------------------------------------

#[test]
fn save_up_to_the_target_then_withdraw_to_an_external_wallet() {
    let s = setup();
    let ada = s.funded_member(1_000);
    let freighter = Address::generate(&s.env);

    // Target is 500 (app-side). Save toward it over several deposits.
    s.client.deposit(&1, &ada, &s.token, &200);
    s.client.deposit(&1, &ada, &s.token, &150);
    s.client.deposit(&1, &ada, &s.token, &150);
    assert_eq!(s.client.balance_of(&1, &ada), 500); // reached

    // Take the whole lot out to a wallet of their choosing.
    let remaining = s.client.withdraw(&1, &ada, &freighter, &500);

    assert_eq!(remaining, 0);
    assert_eq!(s.token_client.balance(&freighter), 500);
    assert_eq!(s.token_client.balance(&s.client.address), 0);
    s.assert_solvent(&[(1, &[ada])]);
}

#[test]
fn a_member_may_stop_and_restart_saving() {
    let s = setup();
    let ada = s.funded_member(1_000);

    s.client.deposit(&1, &ada, &s.token, &300);
    s.client.withdraw(&1, &ada, &ada, &300); // gave up, took it back
    assert_eq!(s.client.balance_of(&1, &ada), 0);

    s.client.deposit(&1, &ada, &s.token, &450); // changed their mind
    assert_eq!(s.client.balance_of(&1, &ada), 450);
    s.assert_solvent(&[(1, &[ada])]);
}
