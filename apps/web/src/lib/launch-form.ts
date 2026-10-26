import {
  ACCEPTED_LOGO_MIME_TYPES,
  LAUNCH_MODE_CAPABILITIES,
  LAUNCH_MODES,
  type LaunchMode,
  MAX_SLIPPAGE_BPS,
  MIN_LOGO_DIMENSION,
  type NetworkId,
  type TokenConfig,
  tokenConfigSchema,
} from "@minthouse/shared";
import type { z } from "zod";

export type CreateField =
  | "name"
  | "symbol"
  | "description"
  | "website"
  | "twitter"
  | "telegram"
  | "decimals"
  | "initialSupply"
  | "recipient"
  | "initialBuySol"
  | "slippagePercent"
  | "network";

export type CreateFormValues = {
  mode: LaunchMode;
  network: NetworkId;
  name: string;
  symbol: string;
  description: string;
  website: string;
  twitter: string;
  telegram: string;
  decimals: string;
  initialSupply: string;
  recipient: string;
  mintingEnabled: boolean;
  mintAuthority: "retain" | "revoke";
  metadataMutable: boolean;
  initialBuySol: string;
  /** Percent, not basis points. 1 means 1%. */
  slippagePercent: string;
};

export type TokenConfigResult =
  | { ok: true; config: TokenConfig }
  | { ok: false; fieldErrors: Partial<Record<CreateField, string>> };

const CREATE_FIELDS = [
  "name",
  "symbol",
  "description",
  "website",
  "twitter",
  "telegram",
  "decimals",
  "initialSupply",
  "recipient",
  "initialBuySol",
  "slippagePercent",
  "network",
] as const satisfies readonly CreateField[];

function isCreateField(value: string): value is CreateField {
  return (CREATE_FIELDS as readonly string[]).includes(value);
}

/**
 * Networks this browser and the API both allow for a launch mode.
 * Pump.fun is further limited to clusters where the API will verify it.
 */
export function networksForLaunch(
  mode: LaunchMode,
  clientNetworks: readonly NetworkId[],
  serverNetworks: readonly NetworkId[],
  pumpNetworks: readonly NetworkId[],
): NetworkId[] {
  return LAUNCH_MODE_CAPABILITIES[mode].networks.filter((network) => {
    if (!clientNetworks.includes(network) || !serverNetworks.includes(network)) {
      return false;
    }
    if (mode === "pumpfun" && !pumpNetworks.includes(network)) {
      return false;
    }
    return true;
  });
}

export function modesForLaunch(
  clientNetworks: readonly NetworkId[],
  serverNetworks: readonly NetworkId[],
  pumpNetworks: readonly NetworkId[],
): LaunchMode[] {
  return LAUNCH_MODES.filter((mode) => networksForLaunch(mode, clientNetworks, serverNetworks, pumpNetworks).length > 0);
}

export function logoFileError(file: File, maxBytes: number): string | null {
  if (!(ACCEPTED_LOGO_MIME_TYPES as readonly string[]).includes(file.type)) {
    return "Use a PNG, JPEG, or WebP image.";
  }
  if (file.size > maxBytes) {
    const megabytes = Math.max(1, Math.round(maxBytes / (1024 * 1024)));
    return `Logo must be at most ${megabytes} MB.`;
  }
  return null;
}

export const MIN_LOGO_SIDE = MIN_LOGO_DIMENSION;

export function initialCreateForm(mode: LaunchMode, network: NetworkId): CreateFormValues {
  return {
    mode,
    network,
    name: "",
    symbol: "",
    description: "",
    website: "",
    twitter: "",
    telegram: "",
    decimals: String(LAUNCH_MODE_CAPABILITIES[mode].decimals.default),
    initialSupply: "1000000",
    recipient: "",
    mintingEnabled: false,
    mintAuthority: "revoke",
    metadataMutable: false,
    initialBuySol: "0",
    slippagePercent: "1",
  };
}

function parseWhole(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) {
    return null;
  }
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** Converts a percent string ("1" or "0.5") into basis points, or null when it is not a permitted slippage. */
function percentToBps(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) {
    return null;
  }
  const bps = Math.round(Number(trimmed) * 100);
  if (bps < 1 || bps > MAX_SLIPPAGE_BPS) {
    return null;
  }
  return bps;
}

function fieldErrorsFromZod(error: z.ZodError): Partial<Record<CreateField, string>> {
  const errors: Partial<Record<CreateField, string>> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && isCreateField(key) && !errors[key]) {
      errors[key] = issue.message;
    }
  }
  return errors;
}

/**
 * Turns the form into the same config the API validates.
 * An empty recipient becomes the connected wallet.
 */
export function toTokenConfig(values: CreateFormValues, creatorAddress: string | null): TokenConfigResult {
  const recipient = values.recipient.trim() || creatorAddress || "";
  const decimals = parseWhole(values.decimals);
  const slippageBps = percentToBps(values.slippagePercent);
  const socials = {
    network: values.network,
    name: values.name,
    symbol: values.symbol,
    description: values.description,
    website: values.website,
    twitter: values.twitter,
    telegram: values.telegram,
  };

  let candidate: unknown;
  switch (values.mode) {
    case "bsc-erc20":
      candidate = {
        ...socials,
        mode: "bsc-erc20",
        decimals: decimals ?? 0,
        initialSupply: values.initialSupply.trim(),
        recipient,
        mintingEnabled: values.mintingEnabled,
      };
      break;
    case "solana-spl":
      candidate = {
        ...socials,
        mode: "solana-spl",
        decimals: decimals ?? 0,
        initialSupply: values.initialSupply.trim(),
        recipient,
        mintAuthority: values.mintAuthority,
        metadataMutable: values.metadataMutable,
      };
      break;
    case "pumpfun":
      candidate = {
        ...socials,
        mode: "pumpfun",
        initialBuySol: values.initialBuySol.trim(),
        slippageBps: slippageBps ?? 1,
      };
      break;
    default: {
      const exhaustive: never = values.mode;
      throw new Error(`Unhandled launch mode ${String(exhaustive)}`);
    }
  }

  const parsed = tokenConfigSchema.safeParse(candidate);
  const errors = parsed.success ? {} : fieldErrorsFromZod(parsed.error);
  const needsRecipient = values.mode === "bsc-erc20" || values.mode === "solana-spl";
  if (needsRecipient && recipient === "") {
    errors.recipient = "Connect a wallet, or paste a recipient address";
  }
  if (needsRecipient && decimals === null) {
    errors.decimals = "Enter a whole number of decimals";
  }
  if (values.mode === "pumpfun" && slippageBps === null) {
    errors.slippagePercent = "Enter a slippage between 0.01% and 50%";
  }

  if (!parsed.success || Object.keys(errors).length > 0) {
    return { ok: false, fieldErrors: errors };
  }
  return { ok: true, config: parsed.data };
}
