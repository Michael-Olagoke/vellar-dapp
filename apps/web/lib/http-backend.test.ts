import { describe, expect, it, vi } from "vitest";
import { createHttpWalletBackend, WalletApiError } from "./http-backend";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("submitWalletCreation", () => {
  it("POSTs the creation payload with serialized XDR and returns the session id", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(201, { txHash: "h", sessionId: "sess-1" }));
    const backend = createHttpWalletBackend("http://api.test/", fetchImpl);

    const result = await backend.submitWalletCreation({
      keyId: "k1",
      contractId: "C1",
      network: "testnet",
      signedTx: { toXDR: () => "xdr-string" },
    });
    expect(result).toEqual({ sessionId: "sess-1" });

    expect(fetchImpl).toHaveBeenCalledWith("http://api.test/wallet/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        keyId: "k1",
        contractId: "C1",
        network: "testnet",
        signedTx: "xdr-string",
      }),
    });
  });

  it("throws a WalletApiError carrying the server's message and code", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(502, {
        error: "relayer_not_configured",
        message: "Relayer is not configured.",
      }),
    );
    const backend = createHttpWalletBackend("http://api.test", fetchImpl);

    const attempt = backend.submitWalletCreation({
      keyId: "k1",
      contractId: "C1",
      network: "testnet",
      signedTx: "xdr",
    });

    await expect(attempt).rejects.toBeInstanceOf(WalletApiError);
    await expect(attempt).rejects.toMatchObject({
      status: 502,
      code: "relayer_not_configured",
      message: "Relayer is not configured.",
    });
  });

  it("copes with non-JSON error bodies", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("gateway exploded", { status: 500 }));
    const backend = createHttpWalletBackend("http://api.test", fetchImpl);
    await expect(
      backend.submitWalletCreation({
        keyId: "k",
        contractId: "C",
        network: "testnet",
        signedTx: "x",
      }),
    ).rejects.toMatchObject({ status: 500, message: "Wallet API request failed (500)" });
  });
});

describe("lookupContractId", () => {
  it("returns the contract and server session ids on success", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { contractId: "C9", sessionId: "s" }));
    const backend = createHttpWalletBackend("http://api.test", fetchImpl);
    await expect(backend.lookupContractId({ keyId: "k", network: "testnet" })).resolves.toEqual({
      contractId: "C9",
      sessionId: "s",
    });
  });

  it("returns undefined for an unknown passkey (404)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404, { error: "wallet_not_found" }));
    const backend = createHttpWalletBackend("http://api.test", fetchImpl);
    await expect(
      backend.lookupContractId({ keyId: "k", network: "testnet" }),
    ).resolves.toBeUndefined();
  });

  it("throws on other failures", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { error: "boom" }));
    const backend = createHttpWalletBackend("http://api.test", fetchImpl);
    await expect(
      backend.lookupContractId({ keyId: "k", network: "testnet" }),
    ).rejects.toBeInstanceOf(WalletApiError);
  });
});

describe("submitTransaction", () => {
  it("POSTs the signed XDR and returns the hash", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { hash: "abc" }));
    const backend = createHttpWalletBackend("http://api.test", fetchImpl);
    await expect(
      backend.submitTransaction({ signedXdr: "xdr", network: "testnet" }),
    ).resolves.toEqual({ hash: "abc" });
    expect(fetchImpl).toHaveBeenCalledWith("http://api.test/wallet/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signedXdr: "xdr", network: "testnet" }),
    });
  });

  it("throws a WalletApiError with the relayer's message on failure", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(502, { error: "relayer_error", message: "fee too low" }));
    const backend = createHttpWalletBackend("http://api.test", fetchImpl);
    await expect(
      backend.submitTransaction({ signedXdr: "xdr", network: "testnet" }),
    ).rejects.toMatchObject({ status: 502, code: "relayer_error", message: "fee too low" });
  });
});

// SEAM-CROSSING integration tests (security-audit.md RA-3 / seam-drift lesson):
// the real http-backend client driven against the REAL wallet-service buildServer
// — NOT a mocked fetch. Mocked-fetch client tests can only assert that the client
// does what the client does; they cannot catch a server contract change (M1
// renamed the session routes and added a required bearer, and the old
// mocked-fetch tests happily pinned the client calling the REMOVED route and
// swallowing the resulting 404 as success). Any route the client calls is
// exercised here against the actual server so the two sides must AGREE.
describe("session client ↔ server seam (real buildServer)", () => {
  // Adapt Fastify's inject() to a fetch-shaped function the client can call.
  async function seamBackend() {
    const { buildServer } = await import("@vellar/wallet-service/server");
    const app = buildServer({
      submitter: { submit: async () => ({ hash: "txhash" }) },
    });
    await app.ready();
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      const res = await app.inject({
        method: (init?.method ?? "GET") as "GET" | "POST",
        url: u.pathname + u.search,
        headers: (init?.headers as Record<string, string>) ?? {},
        payload: init?.body ? (init.body as string) : undefined,
      });
      // 204/205/304 must have a null body per the Fetch spec.
      const nullBody = res.statusCode === 204 || res.statusCode === 205 || res.statusCode === 304;
      return new Response(nullBody ? null : res.body, {
        status: res.statusCode,
        headers: { "content-type": (res.headers["content-type"] as string) ?? "application/json" },
      });
    }) as unknown as typeof fetch;
    const client = createHttpWalletBackend("http://seam.test", fetchImpl);
    return { app, client };
  }

  /** Create a wallet+session via the real client and return the caller's own
   * session id (the M1 bearer). */
  async function openSession(client: ReturnType<typeof createHttpWalletBackend>) {
    const { sessionId } = await client.submitWalletCreation({
      keyId: "key-seam",
      contractId: "CSEAM",
      network: "testnet",
      signedTx: "signed-deploy-xdr",
    });
    return sessionId;
  }

  it("listSessions: the client sends the bearer the server requires (would 401 without it)", async () => {
    const { app, client } = await seamBackend();
    try {
      const bearer = await openSession(client);
      const { sessions } = await client.listSessions({
        contractId: "CSEAM",
        network: "testnet",
        bearerSessionId: bearer,
      });
      expect(sessions.map((s) => s.id)).toContain(bearer);
    } finally {
      await app.close();
    }
  }, 20_000);

  it("listSessions WITHOUT a bearer is rejected by the real server (seam would hide this with a mock)", async () => {
    const { app, client } = await seamBackend();
    try {
      await openSession(client);
      // Call the client's list with an empty bearer — the real server 401s.
      await expect(
        client.listSessions({ contractId: "CSEAM", network: "testnet", bearerSessionId: "" }),
      ).rejects.toMatchObject({ status: 401 });
    } finally {
      await app.close();
    }
  }, 20_000);

  it("revokeSession: hits the REAL /wallet/sessions/revoke route and actually revokes (not a silent no-op)", async () => {
    const { app, client } = await seamBackend();
    try {
      // Two sessions on the same account; revoke the second using the first's bearer.
      const bearer = await openSession(client);
      const connect = await client.lookupContractId({ keyId: "key-seam", network: "testnet" });
      const target = (connect as { sessionId: string }).sessionId;

      await client.revokeSession({ bearerSessionId: bearer, targetSessionId: target });

      // The revoked session is GONE — presenting it as a bearer now 401s.
      await expect(
        client.listSessions({ contractId: "CSEAM", network: "testnet", bearerSessionId: target }),
      ).rejects.toMatchObject({ status: 401 });
      // The caller's own session still works.
      const { sessions } = await client.listSessions({
        contractId: "CSEAM",
        network: "testnet",
        bearerSessionId: bearer,
      });
      expect(sessions.map((s) => s.id)).not.toContain(target);
    } finally {
      await app.close();
    }
  }, 20_000);

  it("revokeSession THROWS on a non-existent target (no 404-swallowed-as-success)", async () => {
    const { app, client } = await seamBackend();
    try {
      const bearer = await openSession(client);
      // A bogus target on our own account → server 404 session_not_found → client MUST throw.
      await expect(
        client.revokeSession({ bearerSessionId: bearer, targetSessionId: "does-not-exist" }),
      ).rejects.toMatchObject({ status: 404 });
    } finally {
      await app.close();
    }
  }, 20_000);

  it("revokeSession without a valid bearer is rejected (401), not silently accepted", async () => {
    const { app, client } = await seamBackend();
    try {
      const bearer = await openSession(client);
      await expect(
        client.revokeSession({ bearerSessionId: "not-a-session", targetSessionId: bearer }),
      ).rejects.toMatchObject({ status: 401 });
    } finally {
      await app.close();
    }
  }, 20_000);
});
