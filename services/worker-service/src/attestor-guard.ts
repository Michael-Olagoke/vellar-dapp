// M5 hard guard (security-audit.md): the attestation registry is a single-key
// oracle — one ATTESTOR_SECRET_KEY compromise forges provenance for any
// contract. The real fix (a multisig / Soroban smart-account attestor) is
// DEFERRED (docs/decisions.md), but the deferral must not silently become a
// mainnet exposure. So: refuse to wire the single-key attestor against a
// MAINNET registry unless an operator explicitly accepts the risk.
//
// RA-10: the network is now taken from the EXPLICIT, cross-checked
// `resolveNetwork` (network-config.ts) — NOT inferred here from a passphrase
// that has a testnet default. This guard no longer classifies the network
// itself; it just refuses single-key-on-mainnet. See the attestor design note
// in docs/security-audit.md (FIX 4) for the intended smart-account attestor.

import type { Network } from "./network-config";

export class SingleKeyAttestorOnMainnetError extends Error {
  constructor() {
    super(
      "Refusing to run the single-key attestor against a MAINNET attestation registry (M5): " +
        "a single ATTESTOR_SECRET_KEY compromise forges provenance for any contract. Configure a " +
        "multisig / smart-account attestor first, or set ALLOW_SINGLE_KEY_ATTESTOR=1 to explicitly " +
        "accept the risk. See docs/security-audit.md (FIX 4).",
    );
    this.name = "SingleKeyAttestorOnMainnetError";
  }
}

/** Throws when a single-key attestor would be wired against mainnet without the
 * explicit override. Takes the resolved network directly (no passphrase
 * inference — RA-10). No-op on testnet. */
export function assertAttestorSafeForNetwork(opts: {
  network: Network;
  allowSingleKey: boolean;
}): void {
  if (opts.network === "mainnet" && !opts.allowSingleKey) {
    throw new SingleKeyAttestorOnMainnetError();
  }
}
