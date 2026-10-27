import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type { NetworkId } from "@minthouse/shared";
import { ApiRequestError } from "./client";
import { fetchPublicConfig, lookupToken, searchTokens } from "./endpoints";
import {
  fetchDexScreenerQuote,
  pumpMarketCapUsd,
  type TokenMarketQuote,
} from "@/lib/token-price";

export const EXPLORE_PAGE_SIZE = 24;
export const RECENT_LAUNCHES_LIMIT = 5;

export type TokenSearchFilters = {
  q?: string;
  network?: NetworkId;
};

/** Query key factory. Every key used by the app is built here. */
export const queryKeys = {
  config: () => ["config"] as const,
  tokens: {
    all: () => ["tokens"] as const,
    search: (filters: TokenSearchFilters) => ["tokens", "search", filters] as const,
    recent: (limit: number) => ["tokens", "recent", limit] as const,
    lookup: (network: NetworkId, address: string) => ["tokens", "lookup", network, address] as const,
    market: (network: NetworkId, address: string) => ["tokens", "market", network, address] as const,
  },
};

export const publicConfigQuery = () =>
  queryOptions({
    queryKey: queryKeys.config(),
    queryFn: ({ signal }) => fetchPublicConfig(signal),
    staleTime: 5 * 60_000,
  });

export const recentLaunchesQuery = (limit = RECENT_LAUNCHES_LIMIT) =>
  queryOptions({
    queryKey: queryKeys.tokens.recent(limit),
    queryFn: ({ signal }) => searchTokens({ limit }, signal),
    staleTime: 30_000,
    retry: 1,
  });

export const tokenSearchQuery = (filters: TokenSearchFilters) =>
  infiniteQueryOptions({
    queryKey: queryKeys.tokens.search(filters),
    queryFn: ({ pageParam, signal }) =>
      searchTokens({ ...filters, limit: EXPLORE_PAGE_SIZE, cursor: pageParam ?? undefined }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 30_000,
  });

/** On-chain reads go stale quickly (supply, authorities, bonding progress), so keep them fresh. */
export const tokenLookupQuery = (network: NetworkId, address: string) =>
  queryOptions({
    queryKey: queryKeys.tokens.lookup(network, address),
    queryFn: ({ signal }) => lookupToken(network, address, signal),
    staleTime: 15_000,
    retry: (failureCount, error) => failureCount < 1 && !isClientError(error),
  });

/**
 * Dollar quotes from DexScreener, or Pump curve × SOL/USD when the token is
 * still on the bonding curve.
 */
export const tokenMarketQuery = (
  network: NetworkId,
  address: string,
  pumpMarketCapLamports: string | null,
) =>
  queryOptions({
    queryKey: queryKeys.tokens.market(network, address),
    queryFn: async ({ signal }): Promise<TokenMarketQuote | null> => {
      const dex = await fetchDexScreenerQuote(address, signal);
      if (dex?.priceUsd !== null && dex?.priceUsd !== undefined) {
        return dex;
      }
      if (pumpMarketCapLamports) {
        return pumpMarketCapUsd(pumpMarketCapLamports, network, signal);
      }
      return dex;
    },
    staleTime: 30_000,
    retry: 1,
  });

function isClientError(error: Error): boolean {
  return error instanceof ApiRequestError && error.status !== null && error.status >= 400 && error.status < 500;
}
