import "@/polyfills";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { type ReactNode, useMemo } from "react";
import { WagmiProvider } from "wagmi";
import { NETWORKS } from "@minthouse/shared";
import { env } from "@/lib/env";
import { rpcUrl } from "@/lib/rpc";
import { wagmiConfig } from "@/stores/wagmi";

function solanaEndpoint(): string {
  const solana = env.VITE_ENABLED_NETWORKS.find(
    (network) => NETWORKS[network].family === "solana",
  );
  return rpcUrl(solana ?? "solana-devnet");
}

/**
 * EVM wallets through wagmi (injected, plus WalletConnect when a Reown project id is set)
 * and Solana wallets installed in the browser. Mounted only around token creation.
 */
export function WalletProviders({ children }: { children: ReactNode }) {
  const endpoint = useMemo(() => solanaEndpoint(), []);
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  );

  return (
    <WagmiProvider config={wagmiConfig} reconnectOnMount>
      <ConnectionProvider endpoint={endpoint}>
        <WalletProvider wallets={wallets} autoConnect>
          {children}
        </WalletProvider>
      </ConnectionProvider>
    </WagmiProvider>
  );
}
