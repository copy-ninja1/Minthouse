import { z } from "zod";
import {
  U64_MAX,
  fitsU64,
  fitsUint256,
  maxDecimalsForWholeTokens,
  parseTokenAmount,
  wholeTokensToBaseUnits,
} from "../amounts.js";
import { LAUNCH_MODE_CAPABILITIES } from "../launch-modes.js";
import { type NetworkId, getNetwork } from "../networks.js";
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

export const SOL_DECIMALS = 9;
export const BNB_DECIMALS = 18;
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

/** Cross-field checks can run after a field-level failure, so they must not throw. */
function safeBaseUnits(wholeTokens: string, decimals: number): bigint | null {
  try {
    return wholeTokensToBaseUnits(wholeTokens, decimals);
  } catch {
    return null;
  }
}

function safeNativeAmount(value: string, decimals: number): bigint | null {
  try {
    return parseTokenAmount(value, decimals);
  } catch {
    return null;
  }
}

/**
 * Seeds a DEX pool so wallets and explorers can show a dollar price.
 * Both sides must be zero (no pool) or both non-zero. Local networks skip the
 * on-chain pool step even when amounts are set.
 */
const liquidityFields = {
  /** Native coin (BNB / SOL) paired into the pool. */
  liquidityNative: z
    .string()
    .trim()
    .regex(
      /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/,
      "Enter a native amount like 0.5 (at most 18 decimal places)",
    )
    .default("0"),
  /** Whole tokens deposited into the pool; must not exceed initial supply. */
  liquidityTokens: wholeTokenAmountField.default("0"),
};

function refineLiquidity(
  config: {
    network: NetworkId;
    initialSupply: string;
    liquidityNative: string;
    liquidityTokens: string;
  },
  nativeDecimals: number,
  ctx: z.RefinementCtx,
): void {
  const network = getNetwork(config.network);
  const native = safeNativeAmount(config.liquidityNative, nativeDecimals);
  if (native === null) {
    ctx.addIssue({
      code: "custom",
      path: ["liquidityNative"],
      message: `Enter a ${network.nativeSymbol} amount like 0.5`,
    });
    return;
  }
  let tokens: bigint;
  try {
    tokens = BigInt(config.liquidityTokens);
  } catch {
    return;
  }
  const supply = (() => {
    try {
      return BigInt(config.initialSupply);
    } catch {
      return null;
    }
  })();

  // Local networks have no DEX. Everywhere else a pool is required so wallets
  // (Trust Wallet, Phantom, etc.) can show a dollar price and chart.
  if (native === 0n && tokens === 0n) {
    if (!network.isLocal) {
      ctx.addIssue({
        code: "custom",
        path: ["liquidityNative"],
        message: `Add ${network.nativeSymbol} liquidity so wallets can show a dollar price`,
      });
      ctx.addIssue({
        code: "custom",
        path: ["liquidityTokens"],
        message: "Add tokens to the pool so the token has a market price",
      });
    }
    return;
  }
  if (native === 0n) {
    ctx.addIssue({
      code: "custom",
      path: ["liquidityNative"],
      message: `Enter a non-zero ${network.nativeSymbol} amount to pair with the tokens`,
    });
  }
  if (tokens === 0n) {
    ctx.addIssue({
      code: "custom",
      path: ["liquidityTokens"],
      message: "Enter a non-zero token amount for the pool",
    });
  }
  if (supply !== null && tokens > supply) {
    ctx.addIssue({
      code: "custom",
      path: ["liquidityTokens"],
      message: "Pool tokens cannot exceed the initial supply",
    });
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
    ...liquidityFields,
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
    refineLiquidity(config, BNB_DECIMALS, ctx);
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
    ...liquidityFields,
    /**
     * SOL spent on a first Raydium swap right after the pool is created so
     * indexers (DexScreener, Trust Wallet) see trade history and a price.
     * Zero skips the swap. Must be less than `liquidityNative` when both are set.
     */
    initialBuySol: solAmountField.default("0"),
    slippageBps: slippageBpsField,
  })
  .superRefine((config, ctx) => {
    const raw = safeBaseUnits(config.initialSupply, config.decimals);
    if (raw === null) {
      return;
    }
    if (!fitsU64(raw)) {
      const maxWhole = U64_MAX / 10n ** BigInt(config.decimals);
      const fitted = maxDecimalsForWholeTokens(BigInt(config.initialSupply));
      const fit =
        fitted === null
          ? "It does not fit even at 0 decimals."
          : `This supply fits with at most ${fitted} decimals.`;
      ctx.addIssue({
        code: "custom",
        path: ["initialSupply"],
        message: `Supply exceeds the SPL Token u64 limit for these decimals. The maximum is ${maxWhole} whole tokens. ${fit}`,
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
    refineLiquidity(config, SOL_DECIMALS, ctx);
    const network = getNetwork(config.network);
    const buy = safeNativeAmount(config.initialBuySol, SOL_DECIMALS);
    const poolNative = safeNativeAmount(config.liquidityNative, SOL_DECIMALS);
    if (
      !network.isLocal &&
      poolNative !== null &&
      poolNative > 0n &&
      (buy === null || buy === 0n)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["initialBuySol"],
        message:
          "Buy a little SOL worth of your token after the pool so wallets can show a price chart",
      });
    }
    if (buy !== null && buy > 0n && poolNative !== null && buy >= poolNative) {
      ctx.addIssue({
        code: "custom",
        path: ["initialBuySol"],
        message: "Initial buy must be smaller than the SOL seeded into the pool",
      });
    }
  });

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
