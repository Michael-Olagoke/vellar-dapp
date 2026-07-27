# Policy Contract — Configurable Spending Limit

Source: `contracts/policy-templates/spending-limit` (crate
`vela-spending-limit-policy`).
Testnet wasm hash: `5d52e44c3794a185aaa4a42478b6b59bf9a976ee0d95b08aab8a855d156e9ff1`.

This is a hardened, **configurable** derivative of the audited passkey-kit
`sample-policy`. It lets a user choose their own spending limit in the UI and
have _that number_ enforced on-chain, per account.

## Why a cumulative window, not a per-transaction cap

A policy signer carries **no secret** — anyone can submit it, so a policy that
authorizes value transfers authorizes them for everyone. That means a
per-transaction cap is **not** a spending limit: repeated capped transfers can
drain the whole balance.

So the user's limit is enforced as a **cumulative allowance over a rolling
window**: the most anyone can move through the policy is `daily_limit` per
`window_seconds`. Worst-case loss is bounded to the cap. For a hard guarantee
that even that bounded amount requires a real signature, the policy can be
paired — via the granting signer's `SignerLimits` — with an authenticated
co-signer.

## Constructor (immutable configuration)

```rust
pub fn __constructor(env: Env, wallet: Address, daily_limit: i128, window_seconds: u64)
```

- `wallet` — the single smart account this instance is bound to.
- `daily_limit` — cumulative window allowance, in **stroops** (1 XLM =
  10,000,000 stroops).
- `window_seconds` — rolling-window length (Vellar uses 24h = 86400 by default).

Configuration is written **once** and never mutated — there is no setter. If the
owner could raise their own cap in-place, the policy would guarantee nothing.
Changing a limit means deploying a fresh instance and re-attaching it with a
passkey (an explicit, auditable admin action).

Range checks: `daily_limit ≥ 1`, `1 ≤ window_seconds ≤ 31,536,000` (365 days).

## Single-tenant binding

Each instance is bound to one wallet at deploy. Both the `install` hook and the
`policy__` authorization check reject any wallet other than the bound one, so a
deployed instance cannot be attached to — or spent through — a different account.

## Preserved security invariants

The contract keeps every hardening property of the reference policy:

- **Caller authentication** — `source.require_auth()` before touching any
  per-wallet state.
- **Deny-by-default** — only positive `transfer`s to a non-wallet contract pass;
  any other function, a non-contract context, a missing/mistyped amount, a
  non-positive amount, or a context targeting the wallet's own admin surface all
  fail closed.
- **Checked arithmetic** throughout.
- **TTL renewal** on install and every successful check, so the policy can't
  silently archive into a wallet lock.
- **Permissionless self-clean** — `uninstall` clears per-wallet state only after
  confirming the policy is genuinely no longer a signer on that wallet.

## Deploy flow

The contract is instantiated per user (see
[Core Flows §4](./core-flows.md#4-create-and-deploy-a-policy)):

1. policy-service deploys a configured instance bound to the account
   (sponsor-funded, from the wasm hash above).
2. The web app passkey-signs `kit.addPolicy(contractId, …)` to attach it, which
   runs the contract's `install` hook.

### Build & test locally

```sh
cd contracts
cargo test -p vela-spending-limit-policy   # unit tests (constructor validation,
                                           # deny-by-default, window enforcement,
                                           # wrong-wallet, TTL, self-clean)
stellar contract build                     # optimized wasm
```

## Token-scoped variant (per-token budgets)

The base spending-limit contract sums **every** SEP-41 `transfer` into one
allowance, regardless of which token moved — so a "$10" cap would also count XLM
or any other token. That is fine for a single-asset account but **must not** back
a per-token (e.g. USDC) budget, which is exactly what an [x402](./x402.md) agent
budget needs.

The **token-scoped** variant (`token-spending-limit`) changes one thing: the
constructor takes a **bound token contract id**, and only that token's transfers
count against the cap.

```
__constructor(wallet: Address, token: Address, daily_limit: i128, window_seconds: u64)
```

It is **fail-closed**: if any context in an invocation is a transfer of a token
other than the bound one (or any non-transfer), the *whole* authorization is
rejected — the policy never partially approves a transfer of a token it does not
govern. An agent that needs two token budgets attaches two token-scoped policies;
the smart wallet supports multiple required co-signers. Every other invariant of
the base contract (single-tenant binding, cumulative rolling window, checked
arithmetic, TTL renewal, deny-by-default, permissionless self-clean) is preserved
verbatim.

Deployed to testnet and proven end to end: a bound-token payment under budget
settles, over budget is rejected, and a different token is rejected — all at the
authorization layer.

## Status

**Testnet only. Not yet audited for mainnet.** Mainnet use is gated on the
smart-contract security-review checklist (see [Security Model](./security-model.md)).
Both the base and token-scoped contracts are dependency-pinned to the audited
passkey-kit contract workspace (soroban-sdk 27, `smart-wallet-interface` via a
pinned commit) and built + verified through the canonical build image.
