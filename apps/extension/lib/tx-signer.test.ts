import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  Account,
  Address,
  Keypair,
  Operation,
  StrKey,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { MAX_EXPIRATION_LEDGERS } from "./signer-expiration";
import type { PairedWallet } from "./state";

const PASSPHRASE = "Test SDF Network ; September 2015";

function contractId(): string {
  return StrKey.encodeContract(Keypair.random().rawPublicKey());
}

const WALLET = contractId();

// Capture what signAuthEntry receives, and prove the caller's rpcUrl is never
// used to derive the expiration anchor. The kit is mocked at the module seam:
// connectWallet resolves to the paired address; signAuthEntry records options
// and returns the entry unchanged (we assert on the recorded expiration).
const signAuthEntryCalls: Array<{ expiration?: number }> = [];

vi.mock("passkey-kit", () => {
  class PasskeyKit {
    contractId = WALLET;
    constructor(_config: unknown) {}
    async connectWallet(_opts: unknown) {
      return { contractId: WALLET };
    }
    async signAuthEntry(entry: unknown, _signer: unknown, options?: { expiration?: number }) {
      signAuthEntryCalls.push({ expiration: options?.expiration });
      return entry;
    }
  }
  return { PasskeyKit };
});

// Build a single-op invokeHostFunction whose one auth entry is address-bound to
// WALLET, so the signer's filter matches it.
function buildTxWithWalletAuth(): string {
  const authEntry = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: Address.fromString(WALLET).toScAddress(),
        nonce: xdr.Int64.fromString("0"),
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: Address.fromString(contractId()).toScAddress(),
          functionName: "noop",
          args: [],
        }),
      ),
      subInvocations: [],
    }),
  });
  const op = Operation.invokeHostFunction({
    func: xdr.HostFunction.hostFunctionTypeInvokeContract(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString(contractId()).toScAddress(),
        functionName: "noop",
        args: [],
      }),
    ),
    auth: [authEntry],
  });
  const src = new Account(Keypair.random().publicKey(), "0");
  return new TransactionBuilder(src, { fee: "100", networkPassphrase: PASSPHRASE })
    .addOperation(op)
    .setTimeout(30)
    .build()
    .toXDR();
}

const wallet: PairedWallet = {
  address: WALLET,
  network: "testnet",
  // A deliberately hostile rpcUrl: if the anchor came from here the test's
  // trusted-ledger fake would never be consulted.
  rpcUrl: "https://attacker.example/rpc",
  keyId: "key-1",
  walletWasmHash: "ab".repeat(32),
};

const deviceKeyPair = {} as CryptoKeyPair;
const deviceRawPublicKey = new Uint8Array(32);

describe("signTransactionXdr (L4 expiration binding)", () => {
  beforeEach(() => {
    signAuthEntryCalls.length = 0;
  });

  it("passes a capped expiration anchored on the TRUSTED ledger, not the caller rpcUrl", async () => {
    const { signTransactionXdr } = await import("./tx-signer");
    const ANCHOR = 1_000_000;
    let trustedUrlSeen: string | undefined;

    await signTransactionXdr({
      xdr: buildTxWithWalletAuth(),
      wallet,
      deviceKeyPair,
      deviceRawPublicKey,
      getTrustedLatestLedger: async (rpcUrl) => {
        trustedUrlSeen = rpcUrl;
        return ANCHOR;
      },
    });

    // The anchor was fetched from the pinned testnet endpoint, NOT wallet.rpcUrl.
    expect(trustedUrlSeen).toBe("https://soroban-testnet.stellar.org");
    expect(trustedUrlSeen).not.toBe(wallet.rpcUrl);
    // Exactly one wallet auth entry signed, with the capped expiration.
    expect(signAuthEntryCalls).toEqual([{ expiration: ANCHOR + MAX_EXPIRATION_LEDGERS }]);
  });

  it("caps the window even when the trusted ledger reports an inflated anchor", async () => {
    const { signTransactionXdr } = await import("./tx-signer");
    const INFLATED = 3_000_000_000;

    await signTransactionXdr({
      xdr: buildTxWithWalletAuth(),
      wallet,
      deviceKeyPair,
      deviceRawPublicKey,
      getTrustedLatestLedger: async () => INFLATED,
    });

    expect(signAuthEntryCalls[0]!.expiration! - INFLATED).toBe(MAX_EXPIRATION_LEDGERS);
  });

  it("fails closed on mainnet when no trusted RPC is configured", async () => {
    const { signTransactionXdr } = await import("./tx-signer");
    await expect(
      signTransactionXdr({
        xdr: buildTxWithWalletAuth(),
        wallet: { ...wallet, network: "mainnet" },
        deviceKeyPair,
        deviceRawPublicKey,
        mainnetRpcUrl: undefined,
        getTrustedLatestLedger: async () => 1,
      }),
    ).rejects.toThrow(/trusted RPC/i);
    // Nothing was signed.
    expect(signAuthEntryCalls).toHaveLength(0);
  });
});
