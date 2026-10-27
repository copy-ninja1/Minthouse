import {
  type Address,
  type Hash,
  type PublicClient,
  type WalletClient,
  erc20Abi,
  getAddress,
  maxUint256,
  parseAbi,
} from "viem";
import {
  BNB_DECIMALS,
  type BscTokenConfig,
  type NetworkId,
  getNetwork,
  parseTokenAmount,
  wholeTokensToBaseUnits,
} from "@minthouse/shared";

/** PancakeSwap Router V2 — creates the pair on first `addLiquidityETH` if needed. */
export const PANCAKE_ROUTER_V2 = {
  "bsc-mainnet": "0x10ED43C718714eb63d5aA57B78B54704E256024E",
  "bsc-testnet": "0xD99D1c33F9fC3444f8101759dFc9d6bBc36ba2aa",
} as const satisfies Partial<Record<NetworkId, Address>>;

const pancakeRouterAbi = parseAbi([
  "function addLiquidityETH(address token, uint256 amountTokenDesired, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity)",
]);

export type PancakeRouterId = keyof typeof PANCAKE_ROUTER_V2;

export function pancakeRouterFor(network: NetworkId): Address | null {
  if (network in PANCAKE_ROUTER_V2) {
    return PANCAKE_ROUTER_V2[network as PancakeRouterId];
  }
  return null;
}

export type SeedBscLiquidityParams = {
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: Address;
  tokenAddress: Address;
  config: BscTokenConfig;
};

export type SeedBscLiquidityResult = {
  approveTxId: Hash;
  liquidityTxId: Hash;
  router: Address;
};

/** True when the config asks for a pool and the network has PancakeSwap. */
export function shouldSeedBscLiquidity(config: BscTokenConfig): boolean {
  if (getNetwork(config.network).isLocal) {
    return false;
  }
  if (pancakeRouterFor(config.network) === null) {
    return false;
  }
  const native = parseTokenAmount(config.liquidityNative, BNB_DECIMALS);
  const tokens = BigInt(config.liquidityTokens);
  return native > 0n && tokens > 0n;
}

/**
 * Approves the PancakeSwap router and seeds a token/WBNB pool.
 * Call only after the LaunchpadToken deploy has confirmed and the creator
 * holds `liquidityTokens` (recipient must be the signing account).
 */
export async function seedBscLiquidity(
  params: SeedBscLiquidityParams,
): Promise<SeedBscLiquidityResult> {
  const router = pancakeRouterFor(params.config.network);
  if (router === null) {
    throw new Error(`No PancakeSwap router on ${params.config.network}`);
  }
  const account = getAddress(params.account);
  const token = getAddress(params.tokenAddress);
  const tokenAmount = wholeTokensToBaseUnits(
    params.config.liquidityTokens,
    params.config.decimals,
  );
  const nativeAmount = parseTokenAmount(params.config.liquidityNative, BNB_DECIMALS);
  if (tokenAmount <= 0n || nativeAmount <= 0n) {
    throw new Error("Liquidity amounts must be greater than zero");
  }

  const balance = await params.publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account],
  });
  if (balance < tokenAmount) {
    throw new Error(
      "The signing account does not hold enough tokens for the pool. Set the recipient to your own address.",
    );
  }

  const approveTxId = await params.walletClient.writeContract({
    address: token,
    abi: erc20Abi,
    functionName: "approve",
    args: [router, maxUint256],
    account,
    chain: params.walletClient.chain,
  });
  await params.publicClient.waitForTransactionReceipt({ hash: approveTxId });

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
  const liquidityTxId = await params.walletClient.writeContract({
    address: router,
    abi: pancakeRouterAbi,
    functionName: "addLiquidityETH",
    args: [token, tokenAmount, tokenAmount, nativeAmount, account, deadline],
    value: nativeAmount,
    account,
    chain: params.walletClient.chain,
  });
  await params.publicClient.waitForTransactionReceipt({ hash: liquidityTxId });

  return { approveTxId, liquidityTxId, router };
}
