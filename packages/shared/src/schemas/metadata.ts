import { z } from "zod";
import { LAUNCH_MODES } from "../launch-modes.js";
import { NETWORK_IDS } from "../networks.js";
import { boundedText, descriptionField, telegramField, tokenSymbol, twitterField, websiteField } from "./fields.js";

/** Formats accepted for upload. SVG is excluded because it can carry script. */
export const ACCEPTED_LOGO_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type AcceptedLogoMimeType = (typeof ACCEPTED_LOGO_MIME_TYPES)[number];
export const DEFAULT_MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const MIN_LOGO_DIMENSION = 128;

export const STORAGE_PROVIDERS = ["ipfs-pinata", "local-dev"] as const;
export type StorageProvider = (typeof STORAGE_PROVIDERS)[number];

export const logoAssetSchema = z.object({
  id: z.uuid(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  /** Square PNG (512×512) used in token metadata. */
  imageUri: z.string(),
  /** 256×256 PNG matching Trust Wallet asset requirements. */
  trustWalletImageUri: z.string().nullable(),
  storage: z.enum(STORAGE_PROVIDERS),
  /** True only for content-addressed, pinned storage. Local development storage is never persistent. */
  persistent: z.boolean(),
  width: z.number().int(),
  height: z.number().int(),
  bytes: z.number().int(),
});
export type LogoAsset = z.infer<typeof logoAssetSchema>;

export const publishMetadataRequestSchema = z.object({
  mode: z.enum(LAUNCH_MODES),
  network: z.enum(NETWORK_IDS),
  logoAssetId: z.uuid(),
  name: boundedText("Name", 64),
  symbol: tokenSymbol(11),
  description: descriptionField,
  website: websiteField,
  twitter: twitterField,
  telegram: telegramField,
});
export type PublishMetadataRequest = z.input<typeof publishMetadataRequestSchema>;

export const publishedMetadataSchema = z.object({
  id: z.uuid(),
  metadataUri: z.string(),
  imageUri: z.string(),
  storage: z.enum(STORAGE_PROVIDERS),
  persistent: z.boolean(),
  /** IPFS documents are content-addressed and cannot change once published. */
  contentAddressed: z.boolean(),
  document: z.record(z.string(), z.unknown()),
});
export type PublishedMetadata = z.infer<typeof publishedMetadataSchema>;

/**
 * Off-chain token metadata JSON. Compatible with the Metaplex fungible token
 * standard and with the fields Pump.fun reads (`showName`, `createdOn`, socials).
 */
export const tokenMetadataDocumentSchema = z.object({
  name: z.string().max(64),
  symbol: z.string().max(11),
  description: z.string().max(1000),
  image: z.string().max(200),
  external_url: z.string().max(200).optional(),
  website: z.string().max(200).optional(),
  twitter: z.string().max(200).optional(),
  telegram: z.string().max(200).optional(),
  showName: z.boolean().optional(),
  createdOn: z.string().max(200).optional(),
  properties: z
    .object({
      category: z.literal("image"),
      files: z.array(z.object({ uri: z.string().max(200), type: z.string().max(50) })).max(4),
    })
    .optional(),
});
export type TokenMetadataDocument = z.infer<typeof tokenMetadataDocumentSchema>;

export type MetadataCheckStatus = "pass" | "fail" | "unknown";

export type MetadataCheck = {
  id:
    | "metadata-reachable"
    | "metadata-valid"
    | "image-reachable"
    | "image-format"
    | "onchain-uri-match"
    | "persistent-storage";
  label: string;
  status: MetadataCheckStatus;
  detail: string;
};

export const verifyMetadataRequestSchema = z.object({
  uri: z.string().trim().max(200),
  /** When both are set, the token's on-chain metadata URI is compared with `uri`. */
  network: z.enum(NETWORK_IDS).optional(),
  tokenAddress: z.string().trim().min(32).max(44).optional(),
});
export type VerifyMetadataRequest = z.infer<typeof verifyMetadataRequestSchema>;

export const metadataVerificationSchema = z.object({
  uri: z.string(),
  checkedAt: z.string(),
  checks: z.array(
    z.object({
      id: z.enum([
        "metadata-reachable",
        "metadata-valid",
        "image-reachable",
        "image-format",
        "onchain-uri-match",
        "persistent-storage",
      ]),
      label: z.string(),
      status: z.enum(["pass", "fail", "unknown"]),
      detail: z.string(),
    }),
  ),
  document: tokenMetadataDocumentSchema.nullable(),
});
export type MetadataVerification = z.infer<typeof metadataVerificationSchema>;
