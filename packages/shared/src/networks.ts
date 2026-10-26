export const CHAIN_FAMILIES = ["bsc", "solana"] as const;
export type ChainFamily = (typeof CHAIN_FAMILIES)[number];

export const NETWORK_IDS = [
  "bsc-mainnet",
  "bsc-testnet",
  "bsc-local",
  "solana-mainnet",
  "solana-devnet",
  "solana-local",
] as const;
export type NetworkId = (typeof NETWORK_IDS)[number];

type Explorer = {
  name: string;
  address: (address: string) => string;
  transaction: (txId: string) => string;
};

type NetworkBase = {
  id: NetworkId;
  label: string;
  isMainnet: boolean;
  /** Local networks are for development only and never appear in production builds. */
  isLocal: boolean;
  nativeSymbol: string;
  defaultRpcUrl: string;
  explorer: Explorer | null;
};

export type EvmNetwork = NetworkBase & {
  family: "bsc";
  chainId: number;
};

export type SolanaCluster = "mainnet-beta" | "devnet" | "localnet";

export type SolanaNetwork = NetworkBase & {
  family: "solana";
  cluster: SolanaCluster;
  /** Wallet-standard chain identifier passed to wallets that accept one. */
  walletStandardChain: "solana:mainnet" | "solana:devnet" | "solana:localnet";
};

export type Network = EvmNetwork | SolanaNetwork;

const bscScan = (baseUrl: string, name: string): Explorer => ({
  name,
  address: (address) => `${baseUrl}/address/${address}`,
  transaction: (txId) => `${baseUrl}/tx/${txId}`,
});

const solanaExplorer = (clusterQuery: string): Explorer => ({
  name: "Solana Explorer",
  address: (address) => `https://explorer.solana.com/address/${address}${clusterQuery}`,
  transaction: (txId) => `https://explorer.solana.com/tx/${txId}${clusterQuery}`,
});

export const NETWORKS = {
  "bsc-mainnet": {
    id: "bsc-mainnet",
    family: "bsc",
    label: "BNB Smart Chain",
    chainId: 56,
    isMainnet: true,
    isLocal: false,
    nativeSymbol: "BNB",
    defaultRpcUrl: "https://bsc-dataseed.bnbchain.org",
    explorer: bscScan("https://bscscan.com", "BscScan"),
  },
  "bsc-testnet": {
    id: "bsc-testnet",
    family: "bsc",
    label: "BNB Smart Chain Testnet",
    chainId: 97,
    isMainnet: false,
    isLocal: false,
    nativeSymbol: "tBNB",
    defaultRpcUrl: "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
    explorer: bscScan("https://testnet.bscscan.com", "BscScan Testnet"),
  },
  "bsc-local": {
    id: "bsc-local",
    family: "bsc",
    label: "Local Hardhat",
    chainId: 31337,
    isMainnet: false,
    isLocal: true,
    nativeSymbol: "ETH",
    defaultRpcUrl: "http://127.0.0.1:8545",
    explorer: null,
  },
  "solana-mainnet": {
    id: "solana-mainnet",
    family: "solana",
    label: "Solana",
    cluster: "mainnet-beta",
    walletStandardChain: "solana:mainnet",
    isMainnet: true,
    isLocal: false,
    nativeSymbol: "SOL",
    defaultRpcUrl: "https://api.mainnet-beta.solana.com",
    explorer: solanaExplorer(""),
  },
  "solana-devnet": {
    id: "solana-devnet",
    family: "solana",
    label: "Solana Devnet",
    cluster: "devnet",
    walletStandardChain: "solana:devnet",
    isMainnet: false,
    isLocal: false,
    nativeSymbol: "SOL",
    defaultRpcUrl: "https://api.devnet.solana.com",
    explorer: solanaExplorer("?cluster=devnet"),
  },
  "solana-local": {
    id: "solana-local",
    family: "solana",
    label: "Local Validator",
    cluster: "localnet",
    walletStandardChain: "solana:localnet",
    isMainnet: false,
    isLocal: true,
    nativeSymbol: "SOL",
    defaultRpcUrl: "http://127.0.0.1:8899",
    explorer: solanaExplorer("?cluster=custom&customUrl=http%3A%2F%2F127.0.0.1%3A8899"),
  },
} as const satisfies Record<NetworkId, Network>;

export function getNetwork(id: NetworkId): Network {
  return NETWORKS[id];
}

export function getEvmNetwork(id: NetworkId): EvmNetwork {
  const network = NETWORKS[id];
  if (network.family !== "bsc") {
    throw new Error(`${id} is not an EVM network`);
  }
  return network;
}

export function getSolanaNetwork(id: NetworkId): SolanaNetwork {
  const network = NETWORKS[id];
  if (network.family !== "solana") {
    throw new Error(`${id} is not a Solana network`);
  }
  return network;
}

export function networksForFamily(family: ChainFamily): Network[] {
  const networks: readonly Network[] = Object.values(NETWORKS);
  return networks.filter((network) => network.family === family);
}

export function findEvmNetworkByChainId(chainId: number): EvmNetwork | undefined {
  const networks: readonly Network[] = Object.values(NETWORKS);
  return networks.find((network): network is EvmNetwork => network.family === "bsc" && network.chainId === chainId);
}

export function isNetworkId(value: string): value is NetworkId {
  return (NETWORK_IDS as readonly string[]).includes(value);
}
