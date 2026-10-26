import { z } from "zod";
import {
  U64_MAX,
  fitsU64,
  fitsUint256,
  wholeTokensToBaseUnits,
} from "../amounts.js";
import { LAUNCH_MODE_CAPABILITIES } from "../launch-modes.js";
import {
  boundedText,
  descriptionField,
  evmAddressField,
  solanaAddressField,
  telegramField,
  tokenSymbol,
  twitterField,
  websiteField,
  wholeTokenAmountField,
} from "./fields.js";

/** Metaplex Token Metadata limits (bytes). Pump.fun uses the same limits. */
export const SOLANA_NAME_MAX_BYTES = 32;
export const SOLANA_SYMBOL_MAX_LENGTH = 10;
export const SOLANA_URI_MAX_BYTES = 200;

export const BSC_NAME_MAX_BYTES = 64;
export const BSC_SYMBOL_MAX_LENGTH = 11;

/** Cross-field checks can run after a field-level failure, so they must not throw. */
function safeBaseUnits(wholeTokens: string, decimals: number): bigint | null {
  try {
    return wholeTokensToBaseUnits(wholeTokens, decimals);
  } catch {
    return null;
  }
}

const socialFields = {
  description: descriptionField,
  website: websiteField,
  twitter: twitterField,
  telegram: telegramField,
};

export const bscTokenConfigSchema = z
  .object({
    mode: z.literal("bsc-erc20"),
    network: z.enum(LAUNCH_MODE_CAPABILITIES["bsc-erc20"].networks),
    name: boundedText("Name", BSC_NAME_MAX_BYTES),
    symbol: tokenSymbol(BSC_SYMBOL_MAX_LENGTH),
    ...socialFields,
    decimals: z.number().int().min(0).max(18),
    /** Whole tokens; converted to base units with `decimals` at deployment. */
    initialSupply: wholeTokenAmountField,
    recipient: evmAddressField,
    /** When false the contract is deployed with minting permanently disabled. */
    mintingEnabled: z.boolean(),
  })
  .superRefine((config, ctx) => {
    const raw = safeBaseUnits(config.initialSupply, config.decimals);
    if (raw === null) {
      return;
    }
    if (!fitsUint256(raw)) {
      ctx.addIssue({
        code: "custom",
        path: ["initialSupply"],
        message: "Supply exceeds the uint256 limit",
      });
    }
    if (raw === 0n && !config.mintingEnabled) {
      ctx.addIssue({
        code: "custom",
        path: ["initialSupply"],
        message: "A fixed-supply token needs a non-zero initial supply",
      });
    }
  });

export const splTokenConfigSchema = z
  .object({
    mode: z.literal("solana-spl"),
    network: z.enum(LAUNCH_MODE_CAPABILITIES["solana-spl"].networks),
    name: boundedText("Name", SOLANA_NAME_MAX_BYTES),
    symbol: tokenSymbol(SOLANA_SYMBOL_MAX_LENGTH),
    ...socialFields,
    decimals: z.number().int().min(0).max(18),
    initialSupply: wholeTokenAmountField,
    recipient: solanaAddressField,
    /** "revoke" removes mint authority in the creation transaction, fixing supply forever. */
    mintAuthority: z.enum(["retain", "revoke"]),
    /** Whether the Metaplex metadata account can be updated by the update authority later. */
    metadataMutable: z.boolean(),
  })
  .superRefine((config, ctx) => {
    const raw = safeBaseUnits(config.initialSupply, config.decimals);
    if (raw === null) {
      return;
    }
    if (!fitsU64(raw)) {
      const maxWhole = U64_MAX / 10n ** BigInt(config.decimals);
      ctx.addIssue({
        code: "custom",
        path: ["initialSupply"],
        message: `Supply exceeds the SPL Token u64 limit for these decimals. The maximum is ${maxWhole} whole tokens.`,
      });
    }
    if (raw === 0n && config.mintAuthority === "revoke") {
      ctx.addIssue({
        code: "custom",
        path: ["initialSupply"],
        message:
          "Revoking mint authority with zero supply would create an unusable token",
      });
    }
  });

export const SOL_DECIMALS = 9;
export const MAX_SLIPPAGE_BPS = 5_000;
export const DEFAULT_SLIPPAGE_BPS = 100;

export const slippageBpsField = z
  .number()
  .int()
  .min(1, "Slippage must be at least 0.01%")
  .max(MAX_SLIPPAGE_BPS, "Slippage above 50% is refused")
  .default(DEFAULT_SLIPPAGE_BPS);

/** A SOL amount as a decimal string with at most 9 fraction digits, e.g. "0.25". */
export const solAmountField = z
  .string()
  .trim()
  .regex(
    /^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/,
    "Enter a SOL amount like 0.5 (at most 9 decimal places)",
  );

export const pumpfunConfigSchema = z.object({
  mode: z.literal("pumpfun"),
  network: z.enum(LAUNCH_MODE_CAPABILITIES.pumpfun.networks),
  name: boundedText("Name", SOLANA_NAME_MAX_BYTES),
  symbol: tokenSymbol(SOLANA_SYMBOL_MAX_LENGTH),
  ...socialFields,
  /**
   * Optional creator buy executed atomically in the launch transaction. Zero
   * means no buy. Never executed separately or automatically.
   */
  initialBuySol: solAmountField.default("0"),
  slippageBps: slippageBpsField,
});

export const tokenConfigSchema = z.discriminatedUnion("mode", [
  bscTokenConfigSchema,
  splTokenConfigSchema,
  pumpfunConfigSchema,
]);

export type BscTokenConfig = z.infer<typeof bscTokenConfigSchema>;
export type SplTokenConfig = z.infer<typeof splTokenConfigSchema>;
export type PumpfunConfig = z.infer<typeof pumpfunConfigSchema>;
export type TokenConfig = z.infer<typeof tokenConfigSchema>;
export type TokenConfigInput = z.input<typeof tokenConfigSchema>;
