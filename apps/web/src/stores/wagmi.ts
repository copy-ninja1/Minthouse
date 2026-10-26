import { NETWORKS } from "@minthouse/shared";
import { createConfig, http } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { env } from "@/lib/env";
import { configuredEvmChains, rpcUrl } from "@/lib/rpc";

const chains = configuredEvmChains();

function endpointForChain(chainId: number): string {
  for (const id of env.VITE_ENABLED_NETWORKS) {
    const candidate = NETWORKS[id];
    if (candidate.family === "bsc" && candidate.chainId === chainId) {
      return rpcUrl(id);
    }
  }
  const fallback = chains.find((chain) => chain.id === chainId)?.rpcUrls.default
    .http[0];
  if (!fallback) {
    throw new Error(`No RPC configured for chain ${chainId}`);
  }
  return fallback;
}

function transports() {
  return Object.fromEntries(
    chains.map((chain) => [chain.id, http(endpointForChain(chain.id))]),
  ) as Record<(typeof chains)[number]["id"], ReturnType<typeof http>>;
}

const projectId = env.VITE_REOWN_PROJECT_ID;

/**
 * Injected browser wallets, plus WalletConnect when a Reown project id is configured.
 * The project id is public; it only identifies this app to the WalletConnect relay.
 */
export const wagmiConfig = createConfig({
  chains,
  connectors: [
    injected({ shimDisconnect: true }),
    ...(projectId
      ? [
          walletConnect({
            projectId,
            showQrModal: true,
            metadata: {
              name: "Minthouse",
              description: "Verifiable multi-chain token launches",
              url: env.VITE_APP_URL,
              icons: [`${env.VITE_APP_URL.replace(/\/$/, "")}/favicon.svg`],
            },
          }),
        ]
      : []),
  ],
  transports: transports(),
  ssr: false,
});
