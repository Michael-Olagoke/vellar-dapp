# Design note — SDK x402 client (`vellar-sdk` 0.4.0)

**Status:** IMPLEMENTED 2026-07-26 (see docs/decisions.md). Built as designed; both signers shipped. Live-validated: the built SDK settled a real x402 payment on-chain (tx `72e5b74c…`). 17 new unit tests; full suite 122 green.
**Scope:** the x402 _client_ only — the fetch wrapper, the smart-account V1 signer, and the max-price guard. Agent session-key management (mint/list/revoke UI) and the headless-agent runtime example are separate BUILD-PLAN items (§17.3 / 8C) and are **out of scope here**.
**Grounding:** technical-doc.md §17.2/§17.3; the proven spike in `scripts/x402-spike/` (matrix a PASS, budget-enforcement PASS, token-scoped PASS); the SDK patterns in `vellar-sdk/src/{client,policy-facade,payments-client}.ts`.

---

## 1. What the spike already settled (so this note doesn't re-litigate it)

- A smart account (C-address) pays x402 via an **ed25519 signer with V1 (`sorobanCredentialsAddress`) credentials** — verified + settled on the live facilitator.
- The off-the-shelf `@x402/stellar` client signer is **wrong for us**: it builds a classic `{public_key, signature}` credential that a Vellar smart wallet's `__check_auth` won't accept. We MUST supply our own signer that produces the smart-wallet signature map (`Vec[Map[SignerKey.Ed25519 → Signature.Ed25519]]`) on a V1 credential.
- Protocol facts the client must honor: the payment goes in the **`PAYMENT-SIGNATURE`** header (not `X-PAYMENT`); the payload must nest **`accepted`** = the requirements; the facilitator advertises `areFeesSponsored` and rebuilds the tx (client must not use the facilitator address as tx source).
- Facilitators verify by **re-simulation** (which runs `__check_auth`, hence the budget policy) — so an over-budget or wrong-token payment is rejected at _verify_ time, before settlement.

None of that is re-designed here; it's the contract the client wraps.

## 2. Public API surface (the proposed shape)

Mirrors the existing facade pattern (`wallet.policies`). A new `wallet.x402` facade on the `createVellarWallet` handle, plus a standalone factory for the headless-agent case that has no passkey wallet handle.

```ts
// ── on the wallet handle (human/passkey flow) ─────────────────────────────
interface VellarWallet {
  // …existing: session, create, connect, pay, policies, connector, payments
  readonly x402: X402Client; // NEW — requires x402 config (see §4)
}

interface X402Client {
  /**
   * Fetch a resource, transparently paying an x402 (HTTP 402) challenge.
   * On 402: parse requirements → build+sign the SEP-41 transfer as a V1 auth
   * entry → retry with PAYMENT-SIGNATURE. Returns the unlocked Response plus
   * the settlement details. Never pays more than `maxAmount` (§3).
   */
  fetch(url: string, init?: X402FetchInit): Promise<X402Response>;

  /**
   * Lower-level: given a decoded 402, produce the signed PAYMENT-SIGNATURE
   * payload without sending it. For callers that manage their own transport.
   */
  createPayment(requirements: PaymentRequirements, opts?: X402PayOptions): Promise<SignedPayment>;
}

interface X402FetchInit extends RequestInit {
  /** Hard ceiling in the asset's base units. Refuse to pay above this. Required. */
  maxAmount: bigint;
  /** Optional: only pay for these assets (SAC contract ids). Default: any the server asks. */
  allowedAssets?: string[];
}

interface X402Response {
  response: Response; // the unlocked resource response (2xx)
  settlement?: {
    // present when a payment was made
    transaction: string; // on-chain settlement tx hash
    payer: string; // the C-address
    asset: string;
    amount: bigint;
  };
  paid: boolean; // false if the resource needed no payment
}
```

### The signer — the core reusable piece

```ts
/**
 * A Vellar smart-account x402 signer. Produces V1 auth-entry signatures a
 * Vellar wallet's __check_auth accepts. Structural (SEP-43-adjacent): callers
 * can supply their own, but the SDK ships the two we need.
 */
interface SmartAccountX402Signer {
  /** The C-address that pays (the auth-entry credential address). */
  readonly address: string;
  /** Sign one V1 auth entry for `address`; returns the signed entry XDR. */
  signAuthEntry(
    entryXdr: string,
    opts: { networkPassphrase: string; expirationLedger: number },
  ): Promise<string>;
}

// Two ships:
//  a) createSessionKeySigner({ address, ed25519Secret, walletSpec }) — the AGENT
//     flow: a raw ed25519 session key signs headlessly (no passkey). This is the
//     one the spike proved; it's what agents use.
//  b) createPasskeyX402Signer({ kit, session }) — the HUMAN flow: routes the
//     auth-entry signing through the passkey (one prompt per payment), for a
//     person paying an x402 resource from the web app.
```

> **Why two signers, one interface:** §17 has both a human (passkey) and an agent (session key) x402 flow. The agent signer is the spike's V1 ed25519 path. The passkey signer reuses the wallet's existing passkey signing but keeps V1 credentials (NOT passkey-kit's forced-V2 path — the SDK owns this signing, exactly as the spike does). Both satisfy `SmartAccountX402Signer`, so `X402Client` is signer-agnostic.

## 3. The max-price guard (client-side safety, not the on-chain budget)

Two independent protections, and the note is explicit that they are different:

- **`maxAmount` (client-side):** the SDK refuses to _sign_ a payment whose required amount exceeds the caller's ceiling — a guard against a malicious/misconfigured server asking for more than expected. Enforced in code, before signing. Cheap, immediate, but only as trustworthy as the client.
- **The on-chain budget (policy contract):** the real enforcement. Even if client code is bypassed, the token-scoped spending-limit policy caps cumulative spend at `__check_auth` time. This is the honest guarantee (§17: "budgets enforced by the policy contract on-chain, not by client code").

The client MUST NOT present `maxAmount` as "the budget." Doc + types will say: `maxAmount` is a per-request client guard; the durable budget is the on-chain policy attached to the session key.

## 4. Config + how it slots in (mirrors `wallet.policies`)

```ts
interface VellarWalletConfig {
  // …existing
  /** x402 config. Without it, `wallet.x402` throws a clear error (like policies without apiUrl). */
  x402?: {
    /** Facilitator base URL (verify/settle/supported). The hosted x402.org, or a
     *  self-hosted one — REQUIRED for policy-governed payments, which exceed the
     *  hosted 50k-stroop fee ceiling (spike finding, decisions.md 2026-07-26). */
    facilitatorUrl: string;
    /** The wallet contract spec source, for encoding the V1 signature ScVals. */
    // (resolved internally from the connected wallet; not caller-supplied)
  };
}
```

Facade wiring copies `createPolicyFacade`: a `requireSession()` seam, a `createX402Client(deps)` factory with structural dependencies (facilitator client, signer, rpc) so it's unit-testable without a network, and an `X402NotConfiguredError` when `x402` config is absent — same ergonomics as `PolicyNotDeployableError`.

## 5. Module layout (new files in `vellar-sdk/src/`)

| File               | Contents                                                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `x402-types.ts`    | `PaymentRequirements`, `X402Response`, `SmartAccountX402Signer`, errors — domain types, no deps on the network.                                                                                        |
| `x402-signer.ts`   | The V1 auth-entry signing recipe (the spike's `signAuthEntryV1` + the smart-wallet signature-map builder), `createSessionKeySigner` + `createPasskeyX402Signer`. The one piece with real crypto.       |
| `x402-client.ts`   | `createX402Client(deps)` — 402 decode, transfer build, sign via the injected signer, `PAYMENT-SIGNATURE` retry, `maxAmount` guard, settlement read. Structural deps (facilitator client, rpc, signer). |
| `x402-facade.ts`   | `createX402Facade` — thin handle glue mirroring `policy-facade.ts`.                                                                                                                                    |
| `client.ts` (edit) | compose `x402` into the handle, gated on `config.x402`.                                                                                                                                                |
| `index.ts` (edit)  | export the new public symbols.                                                                                                                                                                         |

DRY: the V1 signing recipe currently lives (proven) in the spike's `pay.mjs`/`pay-policy.mjs`. It becomes `x402-signer.ts` — the spike scripts are throwaway; this is the real home. No logic is duplicated between them.

## 6. Testing plan (per the standards: unit + integration, err toward more)

- **Unit (no network):** signer produces a well-formed V1 signature map for a known entry; `maxAmount` guard rejects an over-ceiling requirement before signing; `allowedAssets` filters; 402 decode handles the `PAYMENT-SIGNATURE`/`accepted` shape; no-payment-needed passthrough; malformed-402 error paths.
- **Integration (live testnet facilitator, gated like the existing live specs):** a real session-key signer pays a real x402 resource and settles — the spike flow, but through the SDK API. Reuses the self-hosted facilitator harness for policy-governed fees.
- **Edge cases to cover explicitly:** over-budget payment rejected at verify (surfaced as a typed error, not a hang); wrong-asset rejected; facilitator 401/unreachable; expiration-too-far; settlement tx that fails on-chain after verify passed.

## 7. Explicit non-goals for this slice

- Agent session-key **minting/list/revoke** (web Settings UI + `addEd25519` orchestration) — separate item (§17.3, 8C).
- The **headless-agent runtime example** + docs — separate item.
- **USDC/multi-asset plumbing** (token registry, real USDC SAC) — separate 8B item; the client is asset-agnostic and works with whatever token id it's given, so it doesn't block on this.
- **Publishing to npm** — I can build, test, and validate against the live facilitator, but the actual `npm publish` of 0.4.0 needs your 2FA.

## 8. Decisions (resolved 2026-07-26)

1. **Facade name: `wallet.x402`.** Protocol-named and discoverable; distinct from the existing `wallet.pay(to, amount, token)` — does not overload it. (Resolved.)
2. **`maxAmount` is required** — no accidental unbounded payments. A caller who genuinely wants "pay whatever" passes an explicit large value. (Resolved.)
3. **Ship BOTH signers** in this slice — the agent session-key signer and the human passkey signer — so the API is complete for both §17 flows. (Resolved.)
