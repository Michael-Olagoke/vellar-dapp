import { describe, expect, it } from "vitest";
import { NetworkConfigError, resolveNetwork } from "./network-config";

// RA-10: "which network am I on" must be an EXPLICIT, required setting, never
// inferred from a value (the passphrase) that has a testnet default. Absence of
// the signal must fail closed, and the declared network must agree with the
// passphrase and RPC in BOTH directions.

const TESTNET_PASS = "Test SDF Network ; September 2015";
const MAINNET_PASS = "Public Global Stellar Network ; September 2015";
const TESTNET_RPC = "https://soroban-testnet.stellar.org";
const MAINNET_RPC = "https://mainnet.sorobanrpc.com";

describe("resolveNetwork (RA-10 — explicit network + mutual cross-check)", () => {
  it("requires STELLAR_NETWORK: unset fails closed (never assumes testnet)", () => {
    expect(() =>
      resolveNetwork({ network: undefined, passphrase: TESTNET_PASS, rpcUrl: TESTNET_RPC }),
    ).toThrow(NetworkConfigError);
    expect(() =>
      resolveNetwork({ network: "", passphrase: TESTNET_PASS, rpcUrl: TESTNET_RPC }),
    ).toThrow(NetworkConfigError);
  });

  it("rejects an unknown STELLAR_NETWORK value", () => {
    expect(() =>
      resolveNetwork({ network: "devnet", passphrase: TESTNET_PASS, rpcUrl: TESTNET_RPC }),
    ).toThrow(NetworkConfigError);
  });

  it("accepts coherent testnet config", () => {
    expect(
      resolveNetwork({ network: "testnet", passphrase: TESTNET_PASS, rpcUrl: TESTNET_RPC }),
    ).toBe("testnet");
  });

  it("accepts coherent mainnet config", () => {
    expect(
      resolveNetwork({ network: "mainnet", passphrase: MAINNET_PASS, rpcUrl: MAINNET_RPC }),
    ).toBe("mainnet");
  });

  it("refuses testnet-declared but mainnet-looking passphrase (forward mismatch — the RA-10 footgun)", () => {
    let thrown: unknown;
    try {
      resolveNetwork({ network: "testnet", passphrase: MAINNET_PASS, rpcUrl: TESTNET_RPC });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(NetworkConfigError);
    // The error must NAME which value disagreed.
    expect((thrown as Error).message).toMatch(/passphrase/i);
  });

  it("refuses mainnet-declared but testnet-looking passphrase (reverse mismatch)", () => {
    let thrown: unknown;
    try {
      resolveNetwork({ network: "mainnet", passphrase: TESTNET_PASS, rpcUrl: MAINNET_RPC });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(NetworkConfigError);
    expect((thrown as Error).message).toMatch(/passphrase/i);
  });

  it("refuses mainnet-declared but testnet-looking RPC (names the RPC)", () => {
    let thrown: unknown;
    try {
      resolveNetwork({ network: "mainnet", passphrase: MAINNET_PASS, rpcUrl: TESTNET_RPC });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(NetworkConfigError);
    expect((thrown as Error).message).toMatch(/rpc/i);
  });

  it("refuses testnet-declared but mainnet-looking RPC", () => {
    expect(() =>
      resolveNetwork({ network: "testnet", passphrase: TESTNET_PASS, rpcUrl: MAINNET_RPC }),
    ).toThrow(NetworkConfigError);
  });

  it("refuses an UNRECOGNIZED passphrase — can't confirm coherence, so fail closed", () => {
    expect(() =>
      resolveNetwork({
        network: "mainnet",
        passphrase: "Some Custom Network",
        rpcUrl: MAINNET_RPC,
      }),
    ).toThrow(NetworkConfigError);
  });

  it("names ALL disagreeing values, not just the first", () => {
    // testnet declared, but BOTH passphrase and RPC look like mainnet.
    let thrown: unknown;
    try {
      resolveNetwork({ network: "testnet", passphrase: MAINNET_PASS, rpcUrl: MAINNET_RPC });
    } catch (e) {
      thrown = e;
    }
    const msg = (thrown as Error).message;
    expect(msg).toMatch(/passphrase/i);
    expect(msg).toMatch(/rpc/i);
  });
});
