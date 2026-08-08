import {
  Account,
  Asset,
  BASE_FEE,
  Operation,
  TransactionBuilder,
  type Transaction,
  type xdr,
} from "@stellar/stellar-sdk";
import type { HorizonAccount } from "./horizon";

// CleanupExecutor + MergePreflightValidator transaction building (idea.md
// §6.4; decisions.md option A): UNSIGNED classic transactions the user signs
// in the wallet that actually holds the old account's key. Hashes are
// precomputed (they don't change with signatures) so the wizard can watch
// Horizon and auto-advance.

/** Generous window: external signing can be slow. */
const TIMEOUT_SECONDS = 24 * 60 * 60;

/** Stellar's hard protocol limit: a transaction may carry at most 100
 * operations (a 101-op tx is rejected with txTOO_MANY_OPS). Cleanup batches
 * that exceed this are split into consecutive transactions. */
export const OPS_PER_TX = 100;

export interface CleanupStep {
  title: string;
  description: string;
  /** Unsigned transaction envelope, base64 XDR. */
  xdr: string;
  /** Network transaction hash (stable across signing) — watch Horizon for it. */
  hash: string;
}

function toAsset(code: string | undefined, issuer: string | undefined): Asset {
  if (!code || !issuer) throw new Error("Non-native asset is missing code or issuer");
  return new Asset(code, issuer);
}

function step(title: string, description: string, tx: Transaction): CleanupStep {
  return { title, description, xdr: tx.toXDR(), hash: tx.hash().toString("hex") };
}

/** A single cleanup operation plus the human-readable action it performs. */
interface CleanupOp {
  op: xdr.Operation;
  action: string;
}

/** Collects every cleanup operation in dependency order (transfer before
 * trustline removal), each paired with its description. */
function collectCleanupOps(account: HorizonAccount, destination: string): CleanupOp[] {
  const out: CleanupOp[] = [];

  for (const balance of account.balances) {
    if (balance.assetType === "native") continue;
    const asset = toAsset(balance.assetCode, balance.assetIssuer);
    if (Number(balance.balance) > 0) {
      out.push({
        op: Operation.payment({ destination, asset, amount: balance.balance }),
        action: `send ${balance.balance} ${asset.getCode()} to the destination`,
      });
    }
    out.push({
      op: Operation.changeTrust({ asset, limit: "0" }),
      action: `remove the ${asset.getCode()} trustline`,
    });
  }

  for (const offer of account.offers) {
    out.push({
      op: Operation.manageSellOffer({
        selling:
          offer.sellingAssetType === "native"
            ? Asset.native()
            : toAsset(offer.sellingAssetCode, offer.sellingAssetIssuer),
        buying:
          offer.buyingAssetType === "native"
            ? Asset.native()
            : toAsset(offer.buyingAssetCode, offer.buyingAssetIssuer),
        amount: "0",
        price: offer.price,
        offerId: offer.id,
      }),
      action: `cancel offer #${offer.id}`,
    });
  }

  for (const key of account.dataKeys) {
    out.push({
      op: Operation.manageData({ name: key, value: null }),
      action: `delete data entry "${key}"`,
    });
  }

  return out;
}

/**
 * Builds the cleanup transaction(s): asset transfers to the destination,
 * trustline removals, offer cancellations, data deletions — in dependency
 * order. A batch that exceeds the 100-op protocol limit is split into
 * CONSECUTIVE transactions (each ≤ OPS_PER_TX) the user signs and submits in
 * order; the shared `Account` source auto-increments the sequence so tx N+1
 * follows tx N. Empty when there is nothing to clean.
 */
export function buildCleanupSteps(
  account: HorizonAccount,
  destination: string,
  networkPassphrase: string,
): CleanupStep[] {
  const cleanupOps = collectCleanupOps(account, destination);
  if (cleanupOps.length === 0) return [];

  // One shared source: each build() bumps its sequence, so the split
  // transactions carry consecutive sequence numbers.
  const source = new Account(account.accountId, account.sequence);
  const chunkCount = Math.ceil(cleanupOps.length / OPS_PER_TX);
  const steps: CleanupStep[] = [];

  for (let start = 0, part = 1; start < cleanupOps.length; start += OPS_PER_TX, part++) {
    const chunk = cleanupOps.slice(start, start + OPS_PER_TX);
    const builder = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase });
    for (const { op } of chunk) builder.addOperation(op);
    const tx = builder.setTimeout(TIMEOUT_SECONDS).build();

    const actions = chunk.map((c) => c.action).join("; ");
    const title =
      chunkCount === 1 ? "Clean up the account" : `Clean up the account (${part}/${chunkCount})`;
    const description =
      (chunkCount === 1
        ? `One transaction that will: ${actions}.`
        : `Transaction ${part} of ${chunkCount} — sign and submit in order. This one will: ${actions}.`) +
      " Note: the destination must trust any asset being sent to it.";
    steps.push(step(title, description, tx));
  }

  return steps;
}

/** Builds the final account-merge transaction (call only when mergeReady). */
export function buildMergeStep(
  account: HorizonAccount,
  destination: string,
  networkPassphrase: string,
): CleanupStep {
  const source = new Account(account.accountId, account.sequence);
  const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase })
    .addOperation(Operation.accountMerge({ destination }))
    .setTimeout(TIMEOUT_SECONDS)
    .build();
  return step(
    "Merge and close the account",
    `Closes ${account.accountId} and sends its entire XLM balance to ${destination}. This cannot be undone.`,
    tx,
  );
}
