"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Network } from "@vellar/types";
import { walletConfig } from "./config";
import { createHttpWalletBackend } from "./http-backend";

// Session/device management data hooks (technical-doc.md §5.1). Isolated in
// this module so component tests can mock it.

function api() {
  return createHttpWalletBackend(walletConfig().apiUrl);
}

const sessionsKey = (contractId: string | undefined, network: Network) => [
  "sessions",
  contractId,
  network,
];

// bearerSessionId is the caller's OWN live session id (WalletSession
// .serverSessionId) — the M1 bearer capability the list/revoke routes require
// (RA-3). Without it the routes 401, so the query stays disabled until it is
// available (e.g. a session resumed from localStorage before the server id is
// known).
export function useSessions(
  contractId: string | undefined,
  network: Network,
  bearerSessionId: string | undefined,
) {
  return useQuery({
    queryKey: sessionsKey(contractId, network),
    enabled: contractId !== undefined && bearerSessionId !== undefined,
    queryFn: async () =>
      (
        await api().listSessions({
          contractId: contractId as string,
          network,
          bearerSessionId: bearerSessionId as string,
        })
      ).sessions,
  });
}

export function useRevokeSession(
  contractId: string | undefined,
  network: Network,
  bearerSessionId: string | undefined,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (targetSessionId: string) => {
      if (!bearerSessionId) {
        throw new Error("Cannot revoke a session without a live session of your own.");
      }
      return api().revokeSession({ bearerSessionId, targetSessionId });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sessionsKey(contractId, network) }),
  });
}
