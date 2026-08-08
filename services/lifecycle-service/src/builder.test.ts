import { describe, expect, it } from "vitest";
import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { buildCleanupSteps, buildMergeStep, OPS_PER_TX } from "./builder";
import type { HorizonAccount } from "./horizon";

const PASSPHRASE = "Test SDF Network ; September 2015";
const DEST = Keypair.random().publicKey();

function account(overrides: Partial<HorizonAccount> = {}): HorizonAccount {
  return {
    accountId: Keypair.random().publicKey(),
    sequence: "100",
    balances: [{ assetType: "native", balance: "100.0" }],
    dataKeys: [],
    offers: [],
    openOffers: 0,
    ...overrides,
  };
}

/** Decode a step's XDR and return its op count + sequence. */
function decode(xdr: string) {
  const tx = TransactionBuilder.fromXDR(xdr, PASSPHRASE);
  if ("innerTransaction" in tx) throw new Error("unexpected fee-bump tx");
  return { ops: tx.operations.length, sequence: BigInt(tx.sequence) };
}

const dataKeys = (n: number) => Array.from({ length: n }, (_, i) => `k${i}`);

describe("buildCleanupSteps (L6 op-split)", () => {
  it("returns no steps for a clean native-only account", () => {
    expect(buildCleanupSteps(account(), DEST, PASSPHRASE)).toEqual([]);
  });

  it("keeps a sub-limit account in a single transaction", () => {
    const steps = buildCleanupSteps(account({ dataKeys: dataKeys(10) }), DEST, PASSPHRASE);
    expect(steps).toHaveLength(1);
    expect(decode(steps[0]!.xdr).ops).toBe(10);
  });

  it("never emits more than OPS_PER_TX operations in any transaction", () => {
    // 250 data-delete ops must split across ceil(250/100) = 3 transactions.
    const steps = buildCleanupSteps(account({ dataKeys: dataKeys(250) }), DEST, PASSPHRASE);
    expect(steps).toHaveLength(3);
    for (const s of steps) expect(decode(s.xdr).ops).toBeLessThanOrEqual(OPS_PER_TX);
    const total = steps.reduce((n, s) => n + decode(s.xdr).ops, 0);
    expect(total).toBe(250);
  });

  it("gives split transactions CONSECUTIVE sequence numbers so they submit in order", () => {
    const steps = buildCleanupSteps(account({ dataKeys: dataKeys(250) }), DEST, PASSPHRASE);
    const seqs = steps.map((s) => decode(s.xdr).sequence);
    // sequence starts at account.sequence + 1 and increments by exactly 1.
    expect(seqs[0]).toBe(101n);
    expect(seqs[1]).toBe(102n);
    expect(seqs[2]).toBe(103n);
  });

  it("counts a non-zero balance as TWO ops (payment + trustline removal)", () => {
    const steps = buildCleanupSteps(
      account({
        balances: [
          { assetType: "native", balance: "5.0" },
          { assetType: "credit_alphanum4", assetCode: "USDC", assetIssuer: DEST, balance: "12.5" },
        ],
      }),
      DEST,
      PASSPHRASE,
    );
    expect(steps).toHaveLength(1);
    expect(decode(steps[0]!.xdr).ops).toBe(2);
  });

  it("distinct step titles when split, so the wizard can label each", () => {
    const steps = buildCleanupSteps(account({ dataKeys: dataKeys(150) }), DEST, PASSPHRASE);
    expect(steps).toHaveLength(2);
    expect(steps[0]!.title).not.toBe(steps[1]!.title);
  });
});

describe("buildMergeStep", () => {
  it("uses the account's next sequence and merges to the destination", () => {
    const acct = account({ sequence: "500" });
    const step = buildMergeStep(acct, DEST, PASSPHRASE);
    expect(decode(step.xdr).ops).toBe(1);
    expect(decode(step.xdr).sequence).toBe(501n);
  });
});
