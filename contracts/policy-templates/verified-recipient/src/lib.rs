//! VELA verified-recipient policy: the agent's auth entries may only invoke
//! contracts with a LIVE attestation in the attestation registry.
//!
//! ## What this enforces (exact semantics — state them, don't oversell)
//!
//! As a required co-signer in an agent key's `SignerLimits`, this policy runs
//! inside the wallet's `__check_auth` and rejects the WHOLE authorization if
//! any `Context::Contract` in the invocation targets a contract that is not
//! currently attested as verified. The honest claim is therefore: *an agent
//! constrained by this policy cannot transact THROUGH unverified code* — no
//! fake-token transfers, no calls into unattested contracts.
//!
//! It does NOT verify the human/classic-account recipient of funds (an x402
//! `payTo` is often a G-account with no code to verify — that is the
//! facilitator trust layer's job), and an attestation means REPRODUCIBLE
//! SOURCE PROVENANCE, not audited/benign/safe.
//!
//! ## Composition, not replacement
//!
//! This policy carries NO spending accounting. It is designed to stack with
//! the spending-limit policies via multi-policy `SignerLimits` (the smart
//! wallet iterates every required co-signer): budget caps how much, this
//! policy caps through-what. Attach both to an agent key for the full claim
//! "bounded spend, verified code only".
//!
//! ## Deny-by-default, fail-closed
//!
//! Inherited from the policy family: non-contract contexts (deploys etc.)
//! are rejected; the wallet's own admin surface is never authorized; an
//! unverified/expired/unknown contract fails the whole auth. The registry
//! read is ONE cross-contract call per distinct contract in the invocation —
//! bounded work, since `__check_auth` cost is consensus-priced.
//!
//! ## Immutable configuration (deploy-once)
//!
//! Config (wallet, registry) is written once in `__constructor`, no setters.
//! Repointing the registry in-place would let a wallet owner swap in a
//! permissive registry and void the guarantee; changing it means a fresh
//! instance and an explicit passkey-approved re-attach.
//!
//! ## Single-tenant binding
//!
//! Each instance is bound at deploy to ONE wallet; `install` and `policy__`
//! reject any other. Same TTL renewal and permissionless-self-clean behavior
//! as the sibling policies.

#![no_std]

use smart_wallet_interface::{types::SignerKey, PolicyInterface, SmartWalletClient};
use soroban_sdk::{
    auth::{Context, ContractContext},
    contract, contracterror, contractimpl, contracttype, panic_with_error, Address, Env, IntoVal,
    Symbol, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum PolicyError {
    /// A context is not permitted: not a contract invocation, targets the
    /// wallet's own admin surface, or targets a contract without a live
    /// attestation in the registry.
    NotAllowed = 1,
    /// `policy__` was called for a wallet that never installed this policy.
    NotInstalled = 2,
    /// `uninstall` was called while this policy is still a signer on the wallet.
    StillInstalled = 3,
    /// `install`/`policy__` was called by a wallet other than the one this
    /// instance was configured (bound) for at deploy time.
    WrongWallet = 5,
}

/// TTL renewal parameters (in ledgers at the historical 5s close time),
/// identical to the sibling policies: bump to ~30 days whenever remaining TTL
/// drops below ~1 week.
const RENEW_THRESHOLD: u32 = 60 * 60 * 24 / 5 * 7;
const RENEW_TO: u32 = 60 * 60 * 24 / 5 * 30;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StorageKey {
    /// Immutable per-instance configuration, written once by the constructor.
    Config,
    /// Marker that `wallet` completed `install`.
    Installed(Address),
}

/// Immutable configuration set at deploy time.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    /// The single wallet this instance is bound to.
    pub wallet: Address,
    /// The attestation registry consulted for every contract the agent's auth
    /// entries invoke.
    pub registry: Address,
}

#[contract]
pub struct Contract;

#[contractimpl]
impl Contract {
    /// Deploy-time configuration. Runs exactly once (CAP-0058 constructor);
    /// wallet and registry are immutable for the life of the instance.
    pub fn __constructor(env: Env, wallet: Address, registry: Address) {
        env.storage()
            .instance()
            .set::<StorageKey, Config>(&StorageKey::Config, &Config { wallet, registry });
        renew_instance(&env);
    }

    /// Read the immutable configuration (wallet, registry). No auth required.
    pub fn config(env: Env) -> Config {
        load_config(&env)
    }
}

#[contractimpl]
impl PolicyInterface for Contract {
    fn install(env: Env, wallet: Address) {
        // The wallet is the direct invoker during add_signer; invoker auth.
        wallet.require_auth();

        // Single-tenant: refuse to install on any wallet other than the bound
        // one — a hard panic aborts the wallet's add_signer cleanly.
        let config = load_config(&env);
        if wallet != config.wallet {
            panic_with_error!(&env, PolicyError::WrongWallet);
        }

        let installed_key = StorageKey::Installed(wallet);
        env.storage()
            .persistent()
            .set::<StorageKey, bool>(&installed_key, &true);

        renew_instance(&env);
        renew_persistent(&env, &installed_key);
    }

    fn uninstall(env: Env, wallet: Address) {
        // Permissionless, but only once this policy is genuinely no longer a
        // signer on `wallet` (read-only wallet view; griefers can't clear
        // state for a still-installed wallet).
        let still_signer = SmartWalletClient::new(&env, &wallet)
            .get_signer(&SignerKey::Policy(env.current_contract_address()))
            .is_some();

        if still_signer {
            panic_with_error!(&env, PolicyError::StillInstalled);
        }

        env.storage()
            .persistent()
            .remove::<StorageKey>(&StorageKey::Installed(wallet));
    }

    fn policy__(env: Env, source: Address, _signer: SignerKey, contexts: Vec<Context>) {
        // Authenticate the caller really is the wallet before touching any
        // per-wallet state. Satisfied by invoker auth during __check_auth.
        source.require_auth();

        let config = load_config(&env);

        // Single-tenant: this instance only authorizes for its bound wallet.
        if source != config.wallet {
            panic_with_error!(&env, PolicyError::WrongWallet);
        }

        let installed_key = StorageKey::Installed(source.clone());
        if !env.storage().persistent().has::<StorageKey>(&installed_key) {
            panic_with_error!(&env, PolicyError::NotInstalled);
        }

        if contexts.is_empty() {
            // An empty authorization authorizes nothing; refuse rather than
            // rubber-stamp a vacuous auth.
            panic_with_error!(&env, PolicyError::NotAllowed);
        }

        // Deny-by-default over every context: only contract invocations, never
        // the wallet's own admin surface, and EVERY invoked contract must hold
        // a live attestation. One registry read per context — bounded work.
        for context in contexts.iter() {
            match context {
                Context::Contract(ContractContext { contract, .. }) => {
                    // Never authorize the wallet's own admin surface
                    // (add/update/remove/upgrade). `source` is the wallet.
                    if contract == source {
                        panic_with_error!(&env, PolicyError::NotAllowed);
                    }

                    let verified: bool = env.invoke_contract(
                        &config.registry,
                        &Symbol::new(&env, "is_verified"),
                        Vec::from_array(&env, [contract.into_val(&env)]),
                    );
                    if !verified {
                        panic_with_error!(&env, PolicyError::NotAllowed);
                    }
                }
                // Non-contract contexts (deploys, etc.) are never permitted.
                _ => panic_with_error!(&env, PolicyError::NotAllowed),
            }
        }

        // Keep this policy and its per-wallet state alive for as long as it is
        // actively authorizing.
        renew_instance(&env);
        renew_persistent(&env, &installed_key);
    }
}

fn load_config(env: &Env) -> Config {
    env.storage()
        .instance()
        .get::<StorageKey, Config>(&StorageKey::Config)
        // A deployed instance always ran its constructor; fail closed rather
        // than unwrap-panic opaquely.
        .unwrap_or_else(|| panic_with_error!(env, PolicyError::NotInstalled))
}

fn renew_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(RENEW_THRESHOLD, RENEW_TO);
}

fn renew_persistent(env: &Env, key: &StorageKey) {
    env.storage()
        .persistent()
        .extend_ttl::<StorageKey>(key, RENEW_THRESHOLD, RENEW_TO);
}

#[cfg(test)]
mod test;
