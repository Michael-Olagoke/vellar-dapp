"use client";

import { useQuery } from "@tanstack/react-query";
import type { TokenBalance } from "vellar-sdk";
import { walletConfig } from "./config";

// Balance data for the dashboard. The RPC reader (and stellar-sdk with it)
// loads lazily on first use, keeping it off the onboarding path.

async function fetchBalances(accountId: string): Promise<TokenBalance[]> {
  const config = walletConfig();
  const [{ createBalanceService }, { createRpcBalanceReader, nativeToken }] = await Promise.all([
    import("vellar-sdk"),
    import("vellar-sdk/rpc"),
  ]);
  const reader = createRpcBalanceReader({
    rpcUrl: config.rpcUrl,
    networkPassphrase: config.networkPassphrase,
  });
  return createBalanceService(reader, [nativeToken(config.networkPassphrase)]).getBalances(
    accountId,
  );
}

export function useBalances(accountId: string | undefined) {
  return useQuery({
    queryKey: ["balances", accountId],
    enabled: accountId !== undefined,
    queryFn: () => fetchBalances(accountId as string),
    staleTime: 30_000,
  });
}
