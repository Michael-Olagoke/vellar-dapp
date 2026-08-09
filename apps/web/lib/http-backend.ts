import { defaultSignedToXdr, type PaymentSubmitBackend, type WalletBackend } from "vellar-sdk";

// HTTP implementation of the WalletBackend seam, talking to the api-gateway's
// Wallet API (idea.md §11). The relayer key stays server-side; the browser
// only ever ships signed XDR to our own backend.

export class WalletApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "WalletApiError";
    this.status = status;
    this.code = code;
  }
}

async function toApiError(res: Response): Promise<WalletApiError> {
  let payload: { error?: string; message?: string } | undefined;
  try {
    payload = (await res.json()) as { error?: string; message?: string };
  } catch {
    // Non-JSON error body — fall through to the generic message.
  }
  return new WalletApiError(
    payload?.message ?? payload?.error ?? `Wallet API request failed (${res.status})`,
    res.status,
    payload?.error,
  );
}

export interface SessionRecord {
  id: string;
  contractId: string;
  network: string;
  createdAt: string;
  lastActiveAt: string;
}

export interface WalletApiClient extends WalletBackend, PaymentSubmitBackend {
  /** List the sessions for an account. `bearerSessionId` is the CALLER's own
   * live session id (WalletSession.serverSessionId) — the M1 bearer capability
   * (security-audit.md RA-3): the server requires it and scopes the list to the
   * account that session is bound to. */
  listSessions(input: {
    contractId: string;
    network: string;
    bearerSessionId: string;
  }): Promise<{ sessions: SessionRecord[] }>;
  /** Revoke `targetSessionId` (which may be a different device on the same
   * account), authorized by the caller's own live session `bearerSessionId`.
   * A revoke that does not apply (unknown/cross-account target) is a real error,
   * NOT a silent success — see the 404 handling below. */
  revokeSession(input: { bearerSessionId: string; targetSessionId: string }): Promise<void>;
}

export function createHttpWalletBackend(
  apiUrl: string,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): WalletApiClient {
  const base = apiUrl.replace(/\/+$/, "");

  async function post(path: string, body: unknown, bearer?: string): Promise<Response> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    return fetchImpl(`${base}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  }

  return {
    async submitWalletCreation({ keyId, contractId, network, signedTx }) {
      const res = await post("/wallet/create", {
        keyId,
        contractId,
        network,
        signedTx: defaultSignedToXdr(signedTx),
      });
      if (!res.ok) throw await toApiError(res);
      const data = (await res.json()) as { sessionId: string };
      return { sessionId: data.sessionId };
    },

    async lookupContractId({ keyId, network }) {
      const res = await post("/wallet/connect", { keyId, network });
      if (res.status === 404) return undefined;
      if (!res.ok) throw await toApiError(res);
      return (await res.json()) as { contractId: string; sessionId: string };
    },

    async submitTransaction({ signedXdr, network }) {
      const res = await post("/wallet/submit", { signedXdr, network });
      if (!res.ok) throw await toApiError(res);
      return (await res.json()) as { hash: string };
    },

    // Session/device management (technical-doc.md §5.1). Both routes carry the
    // M1 bearer capability (Authorization header, RA-3) — the session id is a
    // credential, so it travels in the header/body, never the URL.
    async listSessions({ contractId, network, bearerSessionId }) {
      const query = new URLSearchParams({ contractId, network });
      const res = await fetchImpl(`${base}/wallet/sessions?${query}`, {
        headers: { authorization: `Bearer ${bearerSessionId}` },
      });
      if (!res.ok) throw await toApiError(res);
      return (await res.json()) as { sessions: SessionRecord[] };
    },

    async revokeSession({ bearerSessionId, targetSessionId }) {
      // POST /wallet/sessions/revoke: the target id is in the BODY (not the URL,
      // which Fastify logs), authorized by the caller's own session bearer. A
      // non-2xx is a REAL failure and MUST throw — the old client swallowed a
      // 404 as success, which silently no-op'd every revoke when the route was
      // renamed. Revocation is a security control; it must fail loudly.
      const res = await post("/wallet/sessions/revoke", { targetSessionId }, bearerSessionId);
      if (!res.ok) throw await toApiError(res);
    },
  };
}
