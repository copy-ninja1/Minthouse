import { z } from "zod";
import { CHAIN_FAMILIES, NETWORK_IDS } from "../networks.js";
import { LAUNCH_MODES } from "../launch-modes.js";
import { OPERATION_STATUSES, OPERATION_TYPES } from "../lifecycle.js";
import { TX_ERROR_CODES } from "../errors.js";
import { tokenConfigSchema } from "./token-config.js";

export const idempotencyKeySchema = z.string().regex(/^[a-f0-9]{64}$/, "Invalid idempotency key");

const txIdSchema = z
  .string()
  .trim()
  .regex(/^(0x[a-fA-F0-9]{64}|[1-9A-HJ-NP-Za-km-z]{64,90})$/, "Invalid transaction hash or signature");

const addressSchema = z.string().trim().min(32).max(44);

export const createDeploymentRequestSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  creator: addressSchema.or(z.string().regex(/^0x[a-fA-F0-9]{40}$/)),
  config: tokenConfigSchema,
  metadataId: z.uuid().nullable(),
});
export type CreateDeploymentRequest = z.input<typeof createDeploymentRequestSchema>;

export const recordSubmissionRequestSchema = z.object({
  txId: txIdSchema,
  /** Expected token address (EVM CREATE address or Solana mint), checked against chain during verification. */
  tokenAddress: z.string().trim().min(32).max(44),
  /** EVM: sender nonce used, so a replaced transaction can be told apart from a pending one. */
  evmNonce: z.number().int().nonnegative().optional(),
  /** Solana: after this block height the transaction can no longer land. */
  lastValidBlockHeight: z.number().int().nonnegative().optional(),
});
export type RecordSubmissionRequest = z.infer<typeof recordSubmissionRequestSchema>;

export const verificationResultSchema = z.object({
  verified: z.boolean(),
  checkedAt: z.string(),
  summary: z.string(),
  details: z.record(z.string(), z.string()),
});
export type VerificationResult = z.infer<typeof verificationResultSchema>;

export const deploymentSchema = z.object({
  id: z.uuid(),
  idempotencyKey: idempotencyKeySchema,
  mode: z.enum(LAUNCH_MODES),
  family: z.enum(CHAIN_FAMILIES),
  network: z.enum(NETWORK_IDS),
  creator: z.string(),
  tokenAddress: z.string().nullable(),
  name: z.string(),
  symbol: z.string(),
  decimals: z.number().int(),
  /** Whole tokens, as configured. */
  initialSupply: z.string(),
  recipient: z.string().nullable(),
  metadataUri: z.string().nullable(),
  imageUri: z.string().nullable(),
  txId: z.string().nullable(),
  status: z.enum(OPERATION_STATUSES),
  errorCode: z.enum(TX_ERROR_CODES).nullable(),
  verification: verificationResultSchema.nullable(),
  /** When the API last asked the chain about this deployment. */
  lastCheckedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Deployment = z.infer<typeof deploymentSchema>;

/** Reported by the client when the deployment ends before anything was submitted (e.g. wallet rejection). */
export const cancelDeploymentRequestSchema = z.object({
  errorCode: z.enum(TX_ERROR_CODES).optional(),
});
export type CancelDeploymentRequest = z.infer<typeof cancelDeploymentRequestSchema>;

export const deploymentListQuerySchema = z.object({
  creator: z.string().trim().min(32).max(44),
  network: z.enum(NETWORK_IDS).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type DeploymentListQuery = z.input<typeof deploymentListQuerySchema>;

/**
 * Live, uncached token state read from the chain by the API. Nothing in this
 * object comes from the application database except `platformDeploymentId`.
 */
export const tokenLookupSchema = z.object({
  family: z.enum(CHAIN_FAMILIES),
  network: z.enum(NETWORK_IDS),
  address: z.string(),
  name: z.string(),
  symbol: z.string(),
  decimals: z.number().int(),
  /** Base units. */
  totalSupply: z.string(),
  /** Detected launch mode; null for tokens not created from a Minthouse/Pump template. */
  mode: z.enum(LAUNCH_MODES).nullable(),
  tokenStandard: z.string(),
  /** BSC: contract owner. Solana: mint authority. null when renounced/revoked or not applicable. */
  owner: z.string().nullable(),
  pendingOwner: z.string().nullable(),
  /** null when the token's code does not expose a minting switch. */
  mintingEnabled: z.boolean().nullable(),
  freezeAuthority: z.string().nullable(),
  metadataUri: z.string().nullable(),
  metadataMutable: z.boolean().nullable(),
  pump: z
    .object({
      phase: z.enum(["bonding", "complete", "migrated"]),
      creator: z.string(),
      bondingCurve: z.string(),
      progressBps: z.number().int(),
      realTokenReserves: z.string(),
      realQuoteReserves: z.string(),
      /** Lamports; null after migration. */
      marketCapLamports: z.string().nullable(),
      pool: z.string(),
    })
    .nullable(),
  platformDeploymentId: z.string().nullable(),
  readAt: z.string(),
});
export type TokenLookup = z.infer<typeof tokenLookupSchema>;

export const TOKEN_SOURCES = ["platform-deployment", "onchain-lookup"] as const;
export type TokenSource = (typeof TOKEN_SOURCES)[number];

export const tokenSummarySchema = z.object({
  family: z.enum(CHAIN_FAMILIES),
  network: z.enum(NETWORK_IDS),
  address: z.string(),
  name: z.string(),
  symbol: z.string(),
  decimals: z.number().int(),
  /** Total supply in base units, from the last on-chain read. */
  totalSupply: z.string().nullable(),
  mode: z.enum(LAUNCH_MODES).nullable(),
  imageUri: z.string().nullable(),
  metadataUri: z.string().nullable(),
  source: z.enum(TOKEN_SOURCES),
  /** When the indexer last confirmed the token's core fields on-chain. */
  onchainVerifiedAt: z.string().nullable(),
  indexedAt: z.string(),
  createdAt: z.string(),
});
export type TokenSummary = z.infer<typeof tokenSummarySchema>;

export const tokenSearchQuerySchema = z.object({
  q: z.string().trim().max(64).optional(),
  family: z.enum(CHAIN_FAMILIES).optional(),
  network: z.enum(NETWORK_IDS).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(64).optional(),
});
export type TokenSearchQuery = z.input<typeof tokenSearchQuerySchema>;

export const tokenPageSchema = z.object({
  items: z.array(tokenSummarySchema),
  nextCursor: z.string().nullable(),
});
export type TokenPage = z.infer<typeof tokenPageSchema>;

export const upsertOperationRequestSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  type: z.enum(OPERATION_TYPES),
  network: z.enum(NETWORK_IDS),
  wallet: z.string().trim().min(32).max(44),
  target: z.string().trim().max(44),
  txId: txIdSchema.nullable(),
  status: z.enum(OPERATION_STATUSES),
  errorCode: z.enum(TX_ERROR_CODES).nullable(),
  summary: z.string().trim().max(200),
});
export type UpsertOperationRequest = z.infer<typeof upsertOperationRequestSchema>;

export const operationHistoryItemSchema = upsertOperationRequestSchema.extend({
  id: z.uuid(),
  family: z.enum(CHAIN_FAMILIES),
  /** Result of the server's independent RPC status check, if one has been made. */
  chainStatus: z.enum(["unknown", "pending", "success", "failed", "not-found"]),
  chainCheckedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type OperationHistoryItem = z.infer<typeof operationHistoryItemSchema>;

export const operationHistoryQuerySchema = z.object({
  wallet: z.string().trim().min(32).max(44),
  network: z.enum(NETWORK_IDS).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type OperationHistoryQuery = z.input<typeof operationHistoryQuerySchema>;

export const apiErrorSchema = z.object({
  statusCode: z.number().int(),
  error: z.string(),
  message: z.string(),
  requestId: z.string().optional(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const publicConfigSchema = z.object({
  networks: z.array(z.enum(NETWORK_IDS)),
  storage: z.object({
    provider: z.enum(["ipfs-pinata", "local-dev"]),
    persistent: z.boolean(),
    maxLogoBytes: z.number().int(),
  }),
  pumpfunNetworks: z.array(z.enum(NETWORK_IDS)),
});
export type PublicConfig = z.infer<typeof publicConfigSchema>;
