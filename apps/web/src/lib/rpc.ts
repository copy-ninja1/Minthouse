import { Connection } from "@solana/web3.js";
import { type Chain, type PublicClient, createPublicClient, defineChain, http } from "viem";
import { bsc, bscTestnet } from "wagmi/chains";
import { type NetworkId, getEvmNetwork, getSolanaNetwork, NETWORKS } from "@minthouse/shared";
import { env } from "@/lib/env";

/** Browser RPC for a network: the optional override, otherwise the public default. */
export function rpcUrl(network: NetworkId): string {
  switch (network) {
    case "bsc-mainnet":
      return env.VITE_BSC_MAINNET_RPC_URL ?? NETWORKS[network].defaultRpcUrl;
    case "bsc-testnet":
      return env.VITE_BSC_TESTNET_RPC_URL ?? NETWORKS[network].defaultRpcUrl;
    case "bsc-local":
      return env.VITE_BSC_LOCAL_RPC_URL ?? NETWORKS[network].defaultRpcUrl;
    case "solana-mainnet":
      return env.VITE_SOLANA_MAINNET_RPC_URL ?? NETWORKS[network].defaultRpcUrl;
    case "solana-devnet":
      return env.VITE_SOLANA_DEVNET_RPC_URL ?? NETWORKS[network].defaultRpcUrl;
    case "solana-local":
      return env.VITE_SOLANA_LOCAL_RPC_URL ?? NETWORKS[network].defaultRpcUrl;
    default: {
      const exhaustive: never = network;
      throw new Error(`Unhandled network ${String(exhaustive)}`);
    }
  }
}

const bscLocal = defineChain({
  id: NETWORKS["bsc-local"].chainId,
  name: NETWORKS["bsc-local"].label,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl("bsc-local")] } },
});

/** Viem chain definition for a BSC network, pointed at this app's RPC. */
export function evmChain(network: NetworkId): Chain {
  getEvmNetwork(network);
  const url = rpcUrl(network);
  switch (network) {
    case "bsc-mainnet":
      return { ...bsc, rpcUrls: { default: { http: [url] } } };
    case "bsc-testnet":
      return { ...bscTestnet, rpcUrls: { default: { http: [url] } } };
    case "bsc-local":
      return bscLocal;
    case "solana-mainnet":
    case "solana-devnet":
    case "solana-local":
      throw new Error(`${network} is not an EVM network`);
    default: {
      const exhaustive: never = network;
      throw new Error(`Unhandled network ${String(exhaustive)}`);
    }
  }
}

export function evmPublicClient(network: NetworkId): PublicClient {
  const chain = evmChain(network);
  return createPublicClient({ chain, transport: http(rpcUrl(network)) });
}

export function solanaConnection(network: NetworkId): Connection {
  getSolanaNetwork(network);
  return new Connection(rpcUrl(network), "confirmed");
}

/** At least one chain, so wagmi's config tuple is satisfied when BSC is disabled. */
export function configuredEvmChains(): readonly [Chain, ...Chain[]] {
  const enabled = env.VITE_ENABLED_NETWORKS.filter((network) => NETWORKS[network].family === "bsc");
  const selected = enabled.length > 0 ? enabled : (["bsc-testnet"] as const);
  const chains = selected.map((network) => evmChain(network));
  const [first, ...rest] = chains;
  if (!first) {
    throw new Error("Expected at least one EVM chain");
  }
  return [first, ...rest];
}
