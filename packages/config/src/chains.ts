import { z } from "zod";
import {
  U64_MAX,
  UINT256_MAX,
  evmAddressField,
  solanaAddressField,
  telegramField,
  twitterField,
  websiteField,
  wholeTokenAmountField,
  wholeTokensToBaseUnits,
} from "@minthouse/shared";
import { booleanString, optionalUrl } from "./helpers.js";

function checkSupplyFits(
  supply: string,
  decimals: number,
  max: bigint,
  limitName: string,
  ctx: z.RefinementCtx,
  path: string,
): void {
  try {
    const raw = wholeTokensToBaseUnits(supply, decimals);
    if (raw > max) {
      const maxWhole = max / 10n ** BigInt(decimals);
      ctx.addIssue({
        code: "custom",
        path: [path],
        message: `${supply} whole tokens at ${decimals} decimals is ${raw} base units, which exceeds the ${limitName} limit. The maximum at ${decimals} decimals is ${maxWhole} whole tokens.`,
      });
    }
  } catch {
    // Field-level validation already reported the malformed value.
  }
}

/** Environment for `chains/bsc` deployment scripts. Supply is in whole tokens. */
export const bscDeployEnvSchema = z
  .object({
    TOKEN_NAME: z.string().trim().min(1).max(64),
    TOKEN_SYMBOL: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9]{1,11}$/, "1–11 letters or digits"),
    TOKEN_DECIMALS: z.coerce.number().int().min(0).max(18).default(18),
    TOKEN_INITIAL_SUPPLY: wholeTokenAmountField,
    /** Defaults to the deployer account when omitted. */
    TOKEN_INITIAL_RECIPIENT: evmAddressField.optional(),
    TOKEN_MINTING_ENABLED: booleanString(true),
  })
  .superRefine((env, ctx) => {
    checkSupplyFits(env.TOKEN_INITIAL_SUPPLY, env.TOKEN_DECIMALS, UINT256_MAX, "uint256", ctx, "TOKEN_INITIAL_SUPPLY");
  });
export type BscDeployEnv = z.infer<typeof bscDeployEnvSchema>;

export const SOLANA_CLUSTERS = ["localnet", "devnet", "mainnet-beta"] as const;

export const solanaConnectionEnvSchema = z.object({
  SOLANA_CLUSTER: z.enum(SOLANA_CLUSTERS).default("devnet"),
  SOLANA_RPC_URL: optionalUrl,
  /** Path to the operator's keypair file (Solana CLI format). The file itself never enters the repository. */
  SOLANA_KEYPAIR_PATH: z.string().trim().min(1).default("~/.config/solana/id.json"),
});
export type SolanaConnectionEnv = z.infer<typeof solanaConnectionEnvSchema>;

/** Environment for `chains/solana` deployment scripts. Supply is in whole tokens. */
export const solanaDeployEnvSchema = solanaConnectionEnvSchema
  .extend({
    SOLANA_TOKEN_NAME: z
      .string()
      .trim()
      .min(1)
      .refine((value) => new TextEncoder().encode(value).length <= 32, "At most 32 bytes"),
    SOLANA_TOKEN_SYMBOL: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9]{1,10}$/, "1–10 letters or digits"),
    SOLANA_TOKEN_DECIMALS: z.coerce
      .number()
      .int()
      .min(0)
      .max(9, "The SPL Token program supports at most 9 decimals")
      .default(9),
    SOLANA_INITIAL_SUPPLY: wholeTokenAmountField,
    SOLANA_INITIAL_RECIPIENT: solanaAddressField.optional(),
    SOLANA_MINT_AUTHORITY: z.enum(["retain", "revoke"]).default("retain"),
    SOLANA_METADATA_MUTABLE: booleanString(true),
    /** Published metadata JSON URI (see `pnpm metadata:publish`). At most 200 bytes. */
    SOLANA_TOKEN_METADATA_URI: z.url({ protocol: /^https$/ }).max(200),
    SOLANA_TOKEN_DESCRIPTION: z.string().max(1000).default(""),
    SOLANA_TOKEN_WEBSITE: websiteField,
    SOLANA_TOKEN_TWITTER: twitterField,
    SOLANA_TOKEN_TELEGRAM: telegramField,
  })
  .superRefine((env, ctx) => {
    checkSupplyFits(env.SOLANA_INITIAL_SUPPLY, env.SOLANA_TOKEN_DECIMALS, U64_MAX, "SPL Token u64", ctx, "SOLANA_INITIAL_SUPPLY");
  });
export type SolanaDeployEnv = z.infer<typeof solanaDeployEnvSchema>;
