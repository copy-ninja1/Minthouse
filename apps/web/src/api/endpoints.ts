import {
  type NetworkId,
  type PublicConfig,
  type TokenLookup,
  type TokenPage,
  type TokenSearchQuery,
  publicConfigSchema,
  tokenLookupSchema,
  tokenPageSchema,
} from "@minthouse/shared";
import { apiClient, parseResponse } from "./client";

export async function fetchPublicConfig(signal?: AbortSignal): Promise<PublicConfig> {
  const response = await apiClient.get<unknown>("/config", { signal });
  return parseResponse(publicConfigSchema, response.data);
}

export async function searchTokens(query: TokenSearchQuery, signal?: AbortSignal): Promise<TokenPage> {
  const response = await apiClient.get<unknown>("/tokens", { params: query, signal });
  return parseResponse(tokenPageSchema, response.data);
}

/** Live, uncached read of a token's on-chain state through the API's RPC clients. */
export async function lookupToken(network: NetworkId, address: string, signal?: AbortSignal): Promise<TokenLookup> {
  const path = `/tokens/${encodeURIComponent(network)}/${encodeURIComponent(address)}`;
  const response = await apiClient.get<unknown>(path, { signal });
  return parseResponse(tokenLookupSchema, response.data);
}
