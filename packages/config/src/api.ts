import { z } from "zod";
import { DEFAULT_MAX_LOGO_BYTES } from "@minthouse/shared";
import { booleanString, networkList, optionalUrl } from "./helpers.js";

export const apiEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, "DATABASE_URL must be a PostgreSQL connection string"),
    CORS_ORIGINS: z
      .string()
      .default("http://localhost:5173")
      .transform((value) =>
        value
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
    /** Public URL of this API, used to build URLs for development-only local storage. */
    PUBLIC_API_URL: z.url({ protocol: /^https?$/ }).default("http://localhost:3000"),
    TRUST_PROXY: booleanString(false),
    ENABLED_NETWORKS: networkList(["bsc-testnet", "solana-devnet"]),

    STORAGE_PROVIDER: z.enum(["pinata", "local"]).default("local"),
    PINATA_JWT: z.string().trim().optional(),
    /** Gateway used in published URIs and for verification fetches. */
    IPFS_GATEWAY_URL: z.url({ protocol: /^https$/ }).default("https://ipfs.io"),
    /** Directory for STORAGE_PROVIDER=local. Files there are temporary development copies. */
    LOCAL_STORAGE_DIR: z.string().trim().min(1).default("storage"),
    MAX_LOGO_BYTES: z.coerce.number().int().min(10_000).max(10 * 1024 * 1024).default(DEFAULT_MAX_LOGO_BYTES),

    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(120),
    UPLOAD_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(10),
    /** Interval for re-checking deployments whose outcome is not yet verified. 0 disables the worker. */
    RECONCILE_INTERVAL_MS: z.coerce.number().int().min(0).default(15_000),

    BSC_MAINNET_RPC_URL: optionalUrl,
    BSC_TESTNET_RPC_URL: optionalUrl,
    BSC_LOCAL_RPC_URL: optionalUrl,
    SOLANA_MAINNET_RPC_URL: optionalUrl,
    SOLANA_DEVNET_RPC_URL: optionalUrl,
    SOLANA_LOCAL_RPC_URL: optionalUrl,
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_PROVIDER === "pinata" && !env.PINATA_JWT) {
      ctx.addIssue({ code: "custom", path: ["PINATA_JWT"], message: "Required when STORAGE_PROVIDER=pinata" });
    }
    if (env.NODE_ENV === "production" && env.STORAGE_PROVIDER === "local") {
      ctx.addIssue({
        code: "custom",
        path: ["STORAGE_PROVIDER"],
        message: "Local storage is temporary and must not be used in production; use pinata",
      });
    }
    if (env.NODE_ENV === "production" && env.ENABLED_NETWORKS.some((id) => id.endsWith("-local"))) {
      ctx.addIssue({ code: "custom", path: ["ENABLED_NETWORKS"], message: "Local networks cannot be enabled in production" });
    }
  });

export type ApiEnv = z.infer<typeof apiEnvSchema>;
