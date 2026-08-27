import { describe, expect, it, vi } from "vitest";
import { createHorizonAccountReader } from "./horizon";

const BASE = "https://horizon.test";
const ACCT = "GCMCEGOUVALP2H6LTY7IPUUMSFKDQUMK3SDU5DI7LETNEZZKHRIIALKM";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const accountBody = {
  sequence: "100",
  balances: [{ asset_type: "native", balance: "50.0" }],
  data: { config: "AA==" },
};

function offerPage(records: unknown[], nextHref?: string) {
  return {
    _links: nextHref ? { next: { href: nextHref } } : { next: { href: "" } },
    _embedded: { records },
  };
}

function offerRecord(id: string) {
  return {
    id,
    selling: { asset_type: "native" },
    buying: { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: ACCT },
    price: "1.0",
  };
}

describe("createHorizonAccountReader", () => {
  it("returns undefined for a 404 account", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 404 }));
    const reader = createHorizonAccountReader(BASE, { fetchImpl });
    expect(await reader.getAccount(ACCT)).toBeUndefined();
  });

  it("throws on a non-ok account response", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 500 }));
    const reader = createHorizonAccountReader(BASE, { fetchImpl });
    await expect(reader.getAccount(ACCT)).rejects.toThrow(/account fetch failed/i);
  });

  it("rejects a malformed account body with a clear error, not a TypeError", async () => {
    // Missing balances/sequence: the old `as`-cast would blow up later with a
    // cryptic `.map of undefined`; runtime validation must fail explicitly.
    const fetchImpl = vi.fn(async () => jsonResponse({ nonsense: true }));
    const reader = createHorizonAccountReader(BASE, { fetchImpl });
    await expect(reader.getAccount(ACCT)).rejects.toThrow(/horizon/i);
  });

  it("follows _links.next to collect offers across ALL pages (L6)", async () => {
    const page1 = offerPage(
      [offerRecord("1"), offerRecord("2")],
      `${BASE}/accounts/${ACCT}/offers?cursor=2&limit=200`,
    );
    const page2 = offerPage([offerRecord("3")]); // no next -> last page
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/offers")) {
        return jsonResponse(url.includes("cursor=2") ? page2 : page1);
      }
      return jsonResponse(accountBody);
    });
    const reader = createHorizonAccountReader(BASE, { fetchImpl });
    const account = await reader.getAccount(ACCT);
    expect(account?.offers.map((o) => o.id)).toEqual(["1", "2", "3"]);
    expect(account?.openOffers).toBe(3);
  });

  it("stops paginating when a page returns no records (guards a self-referential next)", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/offers")) {
        // Always advertises a next link but returns an empty page — must not loop.
        return jsonResponse(offerPage([], `${BASE}/accounts/${ACCT}/offers?cursor=x`));
      }
      return jsonResponse(accountBody);
    });
    const reader = createHorizonAccountReader(BASE, { fetchImpl });
    const account = await reader.getAccount(ACCT);
    expect(account?.offers).toEqual([]);
  });

  it("aborts a hung request via the configured timeout", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        }),
    );
    const reader = createHorizonAccountReader(BASE, { fetchImpl, timeoutMs: 5 });
    await expect(reader.getAccount(ACCT)).rejects.toThrow();
  });
});
