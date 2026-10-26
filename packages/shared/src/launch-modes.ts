import type { ChainFamily, NetworkId } from "./networks.js";

export const LAUNCH_MODES = ["bsc-erc20", "solana-spl", "pumpfun"] as const;
export type LaunchMode = (typeof LAUNCH_MODES)[number];

export type LaunchModeCapabilities = {
  mode: LaunchMode;
  family: ChainFamily;
  label: string;
  tokenStandard: string;
  decimals: {
    min: number;
    max: number;
    default: number;
    configurable: boolean;
  };
  supply: "creator-configured" | "protocol-fixed";
  /** Human-readable explanation of how supply can change after launch. */
  supplyBehavior: string;
  postDeployMint: boolean;
  burn: boolean;
  authorityTransfer: boolean;
  authorityRevoke: boolean;
  bondingCurveTrading: boolean;
  metadataLocation: string;
  networks: readonly NetworkId[];
};

/**
 * Pump.fun fixes supply and decimals in the program, not in the client. The SDK
 * re-exports these values; `packages/blockchain` asserts they still match.
 */
export const PUMPFUN_TOKEN_DECIMALS = 6;
export const PUMPFUN_TOTAL_SUPPLY_WHOLE_TOKENS = 1_000_000_000n;

export const LAUNCH_MODE_CAPABILITIES = {
  "bsc-erc20": {
    mode: "bsc-erc20",
    family: "bsc",
    label: "BNB Smart Chain token",
    tokenStandard: "ERC-20 (BEP-20) — OpenZeppelin, non-upgradeable",
    decimals: { min: 0, max: 18, default: 18, configurable: true },
    supply: "creator-configured",
    supplyBehavior:
      "You choose the initial supply. If minting is enabled, the contract owner can mint more until minting is permanently disabled.",
    postDeployMint: true,
    burn: true,
    authorityTransfer: true,
    authorityRevoke: true,
    bondingCurveTrading: false,
    metadataLocation:
      "Name, symbol and decimals are stored in the contract. Logo and description are application metadata on IPFS; ERC-20 has no on-chain logo field.",
    networks: ["bsc-mainnet", "bsc-testnet", "bsc-local"],
  },
  "solana-spl": {
    mode: "solana-spl",
    family: "solana",
    label: "Solana SPL token",
    tokenStandard: "SPL Token + Metaplex Token Metadata",
    decimals: { min: 0, max: 18, default: 18, configurable: true },
    supply: "creator-configured",
    supplyBehavior:
      "You choose the initial supply. The mint authority can mint more until it is revoked; revocation is permanent.",
    postDeployMint: true,
    burn: true,
    authorityTransfer: true,
    authorityRevoke: true,
    bondingCurveTrading: false,
    metadataLocation:
      "Metaplex metadata account on-chain, pointing to a JSON document on IPFS.",
    networks: ["solana-mainnet", "solana-devnet", "solana-local"],
  },
  pumpfun: {
    mode: "pumpfun",
    family: "solana",
    label: "Pump.fun launch",
    tokenStandard: "Pump.fun bonding-curve token (official Pump program)",
    decimals: {
      min: PUMPFUN_TOKEN_DECIMALS,
      max: PUMPFUN_TOKEN_DECIMALS,
      default: PUMPFUN_TOKEN_DECIMALS,
      configurable: false,
    },
    supply: "protocol-fixed",
    supplyBehavior:
      "The Pump program mints the full fixed supply into its bonding curve and permanently removes mint authority. Nobody — including you — can mint more.",
    postDeployMint: false,
    burn: true,
    authorityTransfer: false,
    authorityRevoke: false,
    bondingCurveTrading: true,
    metadataLocation:
      "Metadata is created by the Pump program, pointing to a JSON document on IPFS. It cannot be edited afterwards.",
    networks: ["solana-mainnet", "solana-devnet"],
  },
} as const satisfies Record<LaunchMode, LaunchModeCapabilities>;

export function getLaunchModeCapabilities(
  mode: LaunchMode,
): LaunchModeCapabilities {
  return LAUNCH_MODE_CAPABILITIES[mode];
}

export function isLaunchMode(value: string): value is LaunchMode {
  return (LAUNCH_MODES as readonly string[]).includes(value);
}
