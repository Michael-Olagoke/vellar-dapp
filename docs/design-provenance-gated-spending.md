# Design: Provenance-Gated Agent Spending + Trust-Scored Bazaar

Status: **designed, not yet building** — gated behind the Vellar x Stellar
Hackathon (Aug 29–31, 2026) and the SCF #45 RFP response. This document is
the build spec so work can start without re-deriving decisions.

## One-line claim

An AI agent whose spending is capped by consensus (existing spending-limit
policies) and which **cannot transact through unverified code** — enforced
on-chain in `__check_auth`, not by any SDK or server — discovering services
through a Bazaar ranked by settlement ground truth and reproducible-build
provenance.

## Why this and why us

Every piece exists in Vellar already; only the combination is new:

| Existing asset                                                                                  | Role here                                                                                                                                   |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract-verification pipeline (byte-for-byte reproducible container builds, deployed + proven) | Source of truth feeding the on-chain attestation registry                                                                                   |
| Policy contracts (`spending-limit`, `token-spending-limit`) proven through x402                 | Skeleton and invariants for the new policy                                                                                                  |
| Smart-wallet `SignerLimits` multi-policy co-signing (passkey-kit)                               | Lets budget + provenance policies compose with no wallet changes                                                                            |
| Vellar Facilitator + Bazaar (live on testnet)                                                   | The only party that sees every settlement → reputation ground truth; the raised fee ceiling makes stacked-policy payments settleable at all |

Honesty bar carried over from the verification work, non-negotiable:
**verified ≠ safe.** Verified means reproducible, attributable, inspectable
source provenance — not audited, not benign. Market it as provenance
control, never as a safety proof.

## Architecture

```
on-chain                              off-chain (existing services, extended)
────────────────────────────          ──────────────────────────────────────
AttestationRegistry (NEW)    ◄──────  attestor worker (NEW, verification-service)
        ▲                                VerificationRecord: verified → upsert
        │ is_verified(contract)          re-verify fail / upgrade seen → revoke
VerifiedRecipientPolicy (NEW)
  agent key's required co-signer      vellar-facilitator (EXTEND)
  runs inside __check_auth              onAfterSettle → per-resource stats
        ▲                               onBeforeVerify → live trust annotation
smart wallet SignerLimits:              Bazaar entries + search ranking gain
  agent → [Policy(spendingLimit),         trust: {verification, settlements,
           Policy(verifiedOnly)]                  uniquePayers, lastSettled}
```

## Component 1 — AttestationRegistry contract

New contract, `contracts/attestation-registry`. Narrow oracle: the
verification service attests which contract addresses currently have
verified source.

```rust
__constructor(attestor: Address)                    // service key; rotatable via attestor auth
upsert(contract: Address, wasm_hash: BytesN<32>, expires_ledger: u32)  // attestor-only
revoke(contract: Address)                           // attestor-only
is_verified(env, contract: Address) -> bool          // exists && ledger < expires
```

- One persistent map keyed by contract address; value carries wasm hash +
  expiry. TTL-bounded (default ~7 days of ledgers) so attestations demand
  continuous re-verification — silence decays to unverified, fail-closed.
- Events on upsert/revoke for indexers.
- Admin model matches the policy contracts: single attestor address,
  rotation by current attestor. No user funds ever touch this contract.

## Component 2 — VerifiedRecipientPolicy contract

New template, `contracts/policy-templates/verified-recipient`, derived from
`token-spending-limit` (same invariants: single-tenant wallet binding in
the constructor, deny-by-default, checked arithmetic, TTL renewal,
permissionless self-clean).

```rust
__constructor(wallet: Address, registry: Address)
policy__(env, source, signer, contexts: Vec<Context>) {
    for ctx in contexts {                    // parse auth_contexts explicitly —
        if let Context::Contract(c) = ctx {  // a policy that ignores them is fake
            if !RegistryClient::new(&env, &registry).is_verified(&c.contract) {
                panic_with_error!(Error::NotAllowed)   // fail closed
            }
        }
    }
}
```

**Exact semantics (state them, don't oversell):** the policy gates the
_contracts the agent's auth entries invoke_ — the token contract in a
transfer, and any other Soroban contract touched. It does **not** verify
the human/classic-account recipient of funds (`payTo` is often a G-account
with no code). The honest claim: _an agent constrained by this policy
cannot transact through unverified code_ — no fake-token transfers, no
calls into unattested contracts. Seller-level trust is the facilitator
layer's job (Component 4).

**Attachment reuses the Phase 5 pipeline unchanged:** new template in
policy-service → validate → generate → `deploy-instance` (sponsor-funded)
→ passkey-signed `kit.addPolicy` → the agent key's `SignerLimits` lists
**both** policies (`[Policy(spendingLimit), Policy(verifiedOnly)]`) —
passkey-kit's `verify_signer_limit_keys` iterates required co-signers, so
budget and provenance compose with zero wallet-contract changes.

## Component 3 — Attestor worker (verification-service extension)

- On `VerificationRecord` → `verified`: submit `registry.upsert(contract,
wasm_hash, now + TTL)`, sponsor-funded through the existing submission
  plumbing.
- Watch job: poll RPC for the current `executable.wasm_hash` of attested
  contracts (the resolver already reads this); on change or failed
  re-verify → `revoke` immediately.
- Attestor secret handled exactly like the sponsor secret: server-side
  env, never client-visible.

## Component 4 — Facilitator trust layer (vellar-facilitator extension)

Two hooks on the already-shipped facilitator:

- **`onAfterSettle`** (~40 lines): per-resource settlement stats into the
  Bazaar catalog — settlement count, unique payers (`result.payer`),
  last-settled timestamp. This is data only a facilitator has; it is the
  ground-truth answer to "which x402 sellers are real."
- **`onBeforeVerify`** (warn-mode default): resolve the payment's asset
  contract against the verification status API **and** the live on-chain
  wasm hash via RPC; annotate the verify response extensions with the
  verdict. Never blocks in warn mode; a strict mode can be per-deployment
  config later.

Bazaar `DiscoveryResource` entries gain a `trust` block —
`{verification, settlements, uniquePayers, lastSettled}` — and the search
scorer takes it as a ranking factor; list/search accept a
`verified_only`-style filter, surfaced through the MCP tools too.

Boundary discipline (existing standing rule): the facilitator repo talks
to verification only over its public HTTP status API + public RPC — no
code dependency between repos.

## The two hard problems (documented, not hidden)

1. **Upgrade staleness (TOCTOU).** A contract can be upgraded after
   attestation, and Soroban gives a policy no host function to read
   another contract's current wasm hash on-chain. Mitigations, layered:
   short attestation TTLs (staleness window ≤ expiry), the attestor's
   revoke-on-upgrade watch, and the facilitator's _live_ hash check at
   verify time (off-chain, so it can). Residual: payments in the minutes
   between an upgrade and revocation. State it in every surface that
   claims enforcement.
2. **`__check_auth` cost.** Each policy adds simulation fee; the registry
   cross-contract call adds a read. Spending policy alone measured ~140k
   stroops; stacked policies + registry likely ~200k+. Most facilitators'
   default 50k ceiling makes such payments unsettleable — the Vellar
   Facilitator's raised ceiling is what makes this design viable in
   practice. Measure the real number during build and publish it.

## Build order and effort (each independently shippable)

1. AttestationRegistry contract + tests — ~2–3 days
2. VerifiedRecipientPolicy contract + tests (canonical-image build,
   self-verified — the container-as-source-of-truth rule applies) — ~3–4 days
3. Attestor worker in verification-service — ~2 days
4. Facilitator trust layer + Bazaar ranking + MCP filter — ~1–2 days
5. Policy template in policy-service + SDK/UI surfacing + docs — ~2 days
6. End-to-end proof, the demo nobody else can run: agent searches a
   trust-ranked Bazaar → pays a verified resource under an on-chain
   budget → attempts an unverified-contract payment → **rejected in
   `__check_auth`**, zero funds moved.

Total: ~2–3 focused weeks. Testnet only until the smart-contract security
checklist covers the two new contracts (same mainnet gate as every other
contract in the project).

## Sequencing

Build starts **after** the hackathon (Aug 29–31) and the SCF RFP
submission. Until then this design is citable in both as the roadmap
centerpiece: "here's what's live; here's the invention it enables."
