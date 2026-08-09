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

/** Decode a step's XDR and return its ordered op types. */
function opTypes(xdr: string): string[] {
  const tx = TransactionBuilder.fromXDR(xdr, PASSPHRASE);
  if ("innerTransaction" in tx) throw new Error("unexpected fee-bump tx");
  return tx.operations.map((o) => o.type);
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

describe("buildCleanupSteps — offer/liability ordering (RA-5)", () => {
  const USDC = { assetType: "credit_alphanum4", assetCode: "USDC", assetIssuer: DEST };

  it("cancels offers BEFORE paying out balances (frees selling liabilities first)", () => {
    // An account holding 100 USDC AND selling 40 USDC on an open offer: 40 is a
    // selling liability, so only 60 is spendable. If the payment of the full 100
    // ran before the cancel it would op_underfunded. The cancel must come first.
    const steps = buildCleanupSteps(
      account({
        balances: [
          { assetType: "native", balance: "100.0" },
          { ...USDC, balance: "100" },
        ],
        offers: [
          {
            id: "7",
            sellingAssetType: "credit_alphanum4",
            sellingAssetCode: "USDC",
            sellingAssetIssuer: DEST,
            buyingAssetType: "native",
            price: "1.0",
          },
        ],
        openOffers: 1,
      }),
      DEST,
      PASSPHRASE,
    );
    expect(steps).toHaveLength(1);
    const types = opTypes(steps[0]!.xdr);
    // Order: cancel the offer, THEN pay the balance, THEN remove the trustline.
    expect(types).toEqual(["manageSellOffer", "payment", "changeTrust"]);
    // Specifically: every manageSellOffer precedes every payment.
    const lastCancel = types.lastIndexOf("manageSellOffer");
    const firstPayment = types.indexOf("payment");
    expect(lastCancel).toBeLessThan(firstPayment);
  });

  it("orders cancels before payments even across MANY offers and balances", () => {
    const steps = buildCleanupSteps(
      account({
        balances: [
          { assetType: "native", balance: "50.0" },
          { ...USDC, balance: "10" },
          { assetType: "credit_alphanum4", assetCode: "EURC", assetIssuer: DEST, balance: "5" },
        ],
        offers: [
          {
            id: "1",
            sellingAssetType: "credit_alphanum4",
            sellingAssetCode: "USDC",
            sellingAssetIssuer: DEST,
            buyingAssetType: "native",
            price: "1",
          },
          {
            id: "2",
            sellingAssetType: "credit_alphanum4",
            sellingAssetCode: "EURC",
            sellingAssetIssuer: DEST,
            buyingAssetType: "native",
            price: "1",
          },
        ],
        openOffers: 2,
      }),
      DEST,
      PASSPHRASE,
    );
    const types = opTypes(steps[0]!.xdr);
    const lastCancel = types.lastIndexOf("manageSellOffer");
    const firstPayment = types.indexOf("payment");
    expect(firstPayment).toBeGreaterThan(lastCancel);
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
