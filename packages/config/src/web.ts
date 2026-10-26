import { z } from "zod";
import { networkList, optionalUrl } from "./helpers.js";

/**
 * Browser build configuration. Everything here ships to users, so it must
 * contain no secrets. RPC URLs with embedded API keys should use keys that
 * are domain-restricted by the RPC provider.
 */
export const webEnvSchema = z.object({
  VITE_API_URL: z.url({ protocol: /^https?$/ }).default("http://localhost:3000"),
  VITE_APP_URL: z.url({ protocol: /^https?$/ }).default("http://localhost:5173"),
  VITE_ENABLED_NETWORKS: networkList(["bsc-testnet", "solana-devnet"]),
  VITE_REOWN_PROJECT_ID: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined))
    .pipe(z.string().regex(/^[a-f0-9]{32}$/, "Reown project ids are 32 hex characters").optional()),
  VITE_BSC_MAINNET_RPC_URL: optionalUrl,
  VITE_BSC_TESTNET_RPC_URL: optionalUrl,
  VITE_BSC_LOCAL_RPC_URL: optionalUrl,
  VITE_SOLANA_MAINNET_RPC_URL: optionalUrl,
  VITE_SOLANA_DEVNET_RPC_URL: optionalUrl,
  VITE_SOLANA_LOCAL_RPC_URL: optionalUrl,
});

export type WebEnv = z.infer<typeof webEnvSchema>;
