#![cfg(test)]

//! Tests for the verified-recipient policy.
//!
//! The registry in these tests is the REAL `vela-attestation-registry`
//! contract (in-tree dev-dependency), so the cross-contract `is_verified`
//! call — the entire point of this policy — is exercised genuinely: attested
//! contracts pass, unattested/expired/revoked ones fail the whole auth
//! closed.
//!
//! As in the sibling policy suites, the wallet is a minimal stub implementing
//! just the `get_signer` view `uninstall` reads, and `mock_all_auths` stands
//! in for the invoker auth the real wallet provides during `__check_auth`
//! (attestor-auth specificity is covered by the registry's own suite).

extern crate std;

use smart_wallet_interface::types::{SignerExpiration, SignerKey, SignerLimits, SignerVal};
use soroban_sdk::{
    auth::{Context, ContractContext},
    contract, contractimpl, symbol_short,
    testutils::{Address as _, Ledger as _},
    Address, BytesN, Env, IntoVal, Vec,
};

use crate::{Config, Contract, ContractClient};
use vela_attestation_registry::{Contract as Registry, ContractClient as RegistryClient};

// ----- Mock wallet: implements only the view uninstall reads. -----

#[contract]
struct MockWallet;

#[contractimpl]
impl MockWallet {
    pub fn __constructor(env: Env, still_signer: bool) {
        env.storage()
            .instance()
            .set(&symbol_short!("SIGNER"), &still_signer);
    }

    pub fn get_signer(env: Env, _signer_key: SignerKey) -> Option<SignerVal> {
        let still: bool = env
            .storage()
            .instance()
            .get(&symbol_short!("SIGNER"))
            .unwrap_or(false);
        if still {
            Some(SignerVal::Policy(SignerExpiration(None), SignerLimits(None)))
        } else {
            None
        }
    }
}

// ----- Fixtures -----

struct Fixture {
    env: Env,
    policy: ContractClient<'static>,
    registry: RegistryClient<'static>,
    wallet: Address,
}

fn setup(wallet_still_signer: bool) -> Fixture {
    let env = Env::default();
    env.mock_all_auths();

    let attestor = Address::generate(&env);
    let registry_id = env.register(Registry, (attestor,));
    let registry = RegistryClient::new(&env, &registry_id);

    let wallet = env.register(MockWallet, (wallet_still_signer,));
    let policy_id = env.register(Contract, (wallet.clone(), registry_id.clone()));
    let policy = ContractClient::new(&env, &policy_id);

    Fixture {
        env,
        policy,
        registry,
        wallet,
    }
}

/// Attest `contract` as verified for the next 1000 ledgers.
fn attest(fx: &Fixture, contract: &Address) {
    let expires = fx.env.ledger().sequence() + 1000;
    fx.registry
        .upsert(contract, &BytesN::from_array(&fx.env, &[0xAB; 32]), &expires);
}

/// A transfer-shaped context invoking `token` from the wallet.
fn ctx_for(fx: &Fixture, token: &Address) -> Context {
    let dest = Address::generate(&fx.env);
    let args: Vec<soroban_sdk::Val> = (fx.wallet.clone(), dest, 1_i128).into_val(&fx.env);
    Context::Contract(ContractContext {
        contract: token.clone(),
        fn_name: symbol_short!("transfer"),
        args,
    })
}

fn single(fx: &Fixture, token: &Address) -> Vec<Context> {
    Vec::from_array(&fx.env, [ctx_for(fx, token)])
}

fn install(fx: &Fixture) {
    fx.policy.install(&fx.wallet);
}

fn signer_key(fx: &Fixture) -> SignerKey {
    SignerKey::Policy(fx.policy.address.clone())
}

// ----- Constructor + config -----

#[test]
fn constructor_stores_config() {
    let fx = setup(false);
    assert_eq!(
        fx.policy.config(),
        Config {
            wallet: fx.wallet.clone(),
            registry: fx.registry.address.clone(),
        }
    );
}

// ----- Install binding -----

#[test]
#[should_panic(expected = "Error(Contract, #5)")] // WrongWallet
fn install_rejects_unbound_wallet() {
    let fx = setup(false);
    let other = fx.env.register(MockWallet, (false,));
    fx.policy.install(&other);
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")] // NotInstalled
fn policy_rejects_before_install() {
    let fx = setup(false);
    let token = Address::generate(&fx.env);
    attest(&fx, &token);
    fx.policy
        .policy__(&fx.wallet, &signer_key(&fx), &single(&fx, &token));
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")] // WrongWallet
fn policy_rejects_unbound_wallet() {
    let fx = setup(false);
    install(&fx);
    let other = fx.env.register(MockWallet, (false,));
    let token = Address::generate(&fx.env);
    attest(&fx, &token);
    fx.policy
        .policy__(&other, &signer_key(&fx), &single(&fx, &token));
}

// ----- The core check: attested passes, everything else fails closed -----

#[test]
fn allows_invocation_of_attested_contract() {
    let fx = setup(false);
    install(&fx);
    let token = Address::generate(&fx.env);
    attest(&fx, &token);
    fx.policy
        .policy__(&fx.wallet, &signer_key(&fx), &single(&fx, &token));
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")] // NotAllowed
fn rejects_unattested_contract() {
    let fx = setup(false);
    install(&fx);
    let token = Address::generate(&fx.env);
    fx.policy
        .policy__(&fx.wallet, &signer_key(&fx), &single(&fx, &token));
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")] // NotAllowed
fn rejects_expired_attestation() {
    let fx = setup(false);
    install(&fx);
    let token = Address::generate(&fx.env);
    let expires = fx.env.ledger().sequence() + 10;
    fx.registry
        .upsert(&token, &BytesN::from_array(&fx.env, &[0x01; 32]), &expires);

    fx.env.ledger().with_mut(|l| l.sequence_number = expires);
    fx.policy
        .policy__(&fx.wallet, &signer_key(&fx), &single(&fx, &token));
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")] // NotAllowed
fn rejects_revoked_attestation() {
    let fx = setup(false);
    install(&fx);
    let token = Address::generate(&fx.env);
    attest(&fx, &token);
    fx.registry.revoke(&token);
    fx.policy
        .policy__(&fx.wallet, &signer_key(&fx), &single(&fx, &token));
}

#[test]
fn allows_multi_context_when_all_attested() {
    let fx = setup(false);
    install(&fx);
    let a = Address::generate(&fx.env);
    let b = Address::generate(&fx.env);
    attest(&fx, &a);
    attest(&fx, &b);
    let contexts = Vec::from_array(&fx.env, [ctx_for(&fx, &a), ctx_for(&fx, &b)]);
    fx.policy.policy__(&fx.wallet, &signer_key(&fx), &contexts);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")] // NotAllowed
fn one_unattested_context_fails_the_whole_auth() {
    let fx = setup(false);
    install(&fx);
    let attested = Address::generate(&fx.env);
    let unattested = Address::generate(&fx.env);
    attest(&fx, &attested);
    let contexts = Vec::from_array(&fx.env, [ctx_for(&fx, &attested), ctx_for(&fx, &unattested)]);
    fx.policy.policy__(&fx.wallet, &signer_key(&fx), &contexts);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")] // NotAllowed
fn rejects_wallet_admin_surface_even_if_wallet_attested() {
    let fx = setup(false);
    install(&fx);
    // Attest the wallet itself — the admin-surface guard must still refuse.
    attest(&fx, &fx.wallet.clone());
    let args: Vec<soroban_sdk::Val> = Vec::new(&fx.env);
    let contexts = Vec::from_array(
        &fx.env,
        [Context::Contract(ContractContext {
            contract: fx.wallet.clone(),
            fn_name: symbol_short!("upgrade"),
            args,
        })],
    );
    fx.policy.policy__(&fx.wallet, &signer_key(&fx), &contexts);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")] // NotAllowed
fn rejects_empty_contexts() {
    let fx = setup(false);
    install(&fx);
    fx.policy
        .policy__(&fx.wallet, &signer_key(&fx), &Vec::new(&fx.env));
}

#[test]
fn reattestation_restores_authorization() {
    let fx = setup(false);
    install(&fx);
    let token = Address::generate(&fx.env);
    attest(&fx, &token);
    fx.registry.revoke(&token);
    assert!(fx
        .policy
        .try_policy__(&fx.wallet, &signer_key(&fx), &single(&fx, &token))
        .is_err());

    attest(&fx, &token);
    fx.policy
        .policy__(&fx.wallet, &signer_key(&fx), &single(&fx, &token));
}

// ----- Uninstall -----

#[test]
#[should_panic(expected = "Error(Contract, #3)")] // StillInstalled
fn uninstall_refuses_while_still_signer() {
    let fx = setup(true);
    install(&fx);
    fx.policy.uninstall(&fx.wallet);
}

#[test]
fn uninstall_clears_state_once_removed_as_signer() {
    let fx = setup(false);
    install(&fx);
    fx.policy.uninstall(&fx.wallet);
    // After uninstall the install marker is gone: policy__ refuses again.
    let token = Address::generate(&fx.env);
    attest(&fx, &token);
    assert!(fx
        .policy
        .try_policy__(&fx.wallet, &signer_key(&fx), &single(&fx, &token))
        .is_err());
}
