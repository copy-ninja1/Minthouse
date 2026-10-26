import {
  type CancelDeploymentRequest,
  type CreateDeploymentRequest,
  type Deployment,
  type LogoAsset,
  type NetworkId,
  type PublicConfig,
  type PublishMetadataRequest,
  type PublishedMetadata,
  type RecordSubmissionRequest,
  type TokenLookup,
  type TokenPage,
  type TokenSearchQuery,
  deploymentSchema,
  logoAssetSchema,
  publicConfigSchema,
  publishedMetadataSchema,
  tokenLookupSchema,
  tokenPageSchema,
} from "@minthouse/shared";
import { apiClient, parseResponse } from "./client";

export async function fetchPublicConfig(
  signal?: AbortSignal,
): Promise<PublicConfig> {
  const response = await apiClient.get<unknown>("/config", { signal });
  return parseResponse(publicConfigSchema, response.data);
}

export async function searchTokens(
  query: TokenSearchQuery,
  signal?: AbortSignal,
): Promise<TokenPage> {
  const response = await apiClient.get<unknown>("/tokens", {
    params: query,
    signal,
  });
  return parseResponse(tokenPageSchema, response.data);
}

export async function uploadLogo(
  file: File,
  signal?: AbortSignal,
): Promise<LogoAsset> {
  const body = new FormData();
  body.append("file", file);
  const response = await apiClient.post<unknown>("/assets/logo", body, {
    signal,
    timeout: 60_000,
  });
  return parseResponse(logoAssetSchema, response.data);
}

export async function publishMetadata(
  body: PublishMetadataRequest,
  signal?: AbortSignal,
): Promise<PublishedMetadata> {
  const response = await apiClient.post<unknown>("/metadata", body, {
    signal,
    timeout: 60_000,
  });
  return parseResponse(publishedMetadataSchema, response.data);
}

export async function createDeployment(
  body: CreateDeploymentRequest,
  signal?: AbortSignal,
): Promise<Deployment> {
  const response = await apiClient.post<unknown>("/deployments", body, {
    signal,
  });
  return parseResponse(deploymentSchema, response.data);
}

export async function getDeployment(
  id: string,
  signal?: AbortSignal,
): Promise<Deployment> {
  const response = await apiClient.get<unknown>(
    `/deployments/${encodeURIComponent(id)}`,
    { signal },
  );
  return parseResponse(deploymentSchema, response.data);
}

export async function recordSubmission(
  id: string,
  body: RecordSubmissionRequest,
  signal?: AbortSignal,
): Promise<Deployment> {
  const response = await apiClient.post<unknown>(
    `/deployments/${encodeURIComponent(id)}/submission`,
    body,
    { signal },
  );
  return parseResponse(deploymentSchema, response.data);
}

export async function cancelDeployment(
  id: string,
  body: CancelDeploymentRequest,
  signal?: AbortSignal,
): Promise<Deployment> {
  const response = await apiClient.post<unknown>(
    `/deployments/${encodeURIComponent(id)}/cancel`,
    body,
    { signal },
  );
  return parseResponse(deploymentSchema, response.data);
}

/** Live, uncached read of a token's on-chain state through the API's RPC clients. */
export async function lookupToken(
  network: NetworkId,
  address: string,
  signal?: AbortSignal,
): Promise<TokenLookup> {
  const path = `/tokens/${encodeURIComponent(network)}/${encodeURIComponent(address)}`;
  const response = await apiClient.get<unknown>(path, { signal });
  return parseResponse(tokenLookupSchema, response.data);
}
