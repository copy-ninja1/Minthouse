import { useWallet } from "@solana/wallet-adapter-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { getWalletClient, switchChain } from "wagmi/actions";
import { useConfig, useConnection } from "wagmi";
import { getNetwork, TX_ERROR_MESSAGES, type Deployment, type TokenConfig } from "@minthouse/shared";
import {
  cancelDeployment,
  createDeployment,
  getDeployment,
  publishMetadata,
  recordSubmission,
  uploadLogo,
} from "@/api/endpoints";
import { queryKeys } from "@/api/queries";
import { ChainLaunchError } from "@/lib/chain-launch-error";
import { type LaunchStep, LaunchFlowError, launchToken } from "@/lib/launch-token";
import { evmPublicClient, solanaConnection } from "@/lib/rpc";
import { submitBscLaunch } from "@/lib/submit-bsc-launch";
import { submitSolanaLaunch } from "@/lib/submit-solana-launch";

export type LaunchView =
  | { status: "idle" }
  | { status: "running"; step: LaunchStep }
  | { status: "success"; deployment: Deployment }
  | { status: "error"; message: string; deployment: Deployment | null };

const launchApi = {
  uploadLogo: (file: File) => uploadLogo(file),
  publishMetadata: (body: Parameters<typeof publishMetadata>[0]) => publishMetadata(body),
  createDeployment: (body: Parameters<typeof createDeployment>[0]) => createDeployment(body),
  recordSubmission: (id: string, body: Parameters<typeof recordSubmission>[1]) => recordSubmission(id, body),
  cancelDeployment: (id: string, body: Parameters<typeof cancelDeployment>[1]) => cancelDeployment(id, body),
  getDeployment: (id: string) => getDeployment(id),
};

/**
 * Runs one launch and keeps the visible step in state.
 * Chain calls happen inside the deployer, after metadata is published.
 */
export function useTokenLaunch() {
  const [view, setView] = useState<LaunchView>({ status: "idle" });
  const mounted = useRef(true);
  const queryClient = useQueryClient();
  const evm = useConnection();
  const config = useConfig();
  const solana = useWallet();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const update = (next: LaunchView) => {
    if (mounted.current) {
      setView(next);
    }
  };

  const launch = async (token: TokenConfig, logo: File) => {
    const family = getNetwork(token.network).family;
    update({ status: "running", step: "publish" });
    try {
      const deployment = await launchToken(
        {
          config: token,
          logo,
          deployer:
            family === "bsc"
              ? {
                  family: "bsc",
                  address: evm.address ?? "",
                  submit: async (requested, _metadataUri) => {
                    if (requested.mode !== "bsc-erc20") {
                      throw new ChainLaunchError("UNKNOWN", "This token is not a BNB Smart Chain launch.", false);
                    }
                    if (!evm.address) {
                      throw new ChainLaunchError("WALLET_UNAVAILABLE", TX_ERROR_MESSAGES.WALLET_UNAVAILABLE, false);
                    }
                    return submitBscLaunch(
                      evmPublicClient(requested.network),
                      {
                        chainId: evm.chainId,
                        switchChain: async (chainId) => {
                          await switchChain(config, { chainId });
                        },
                        deployContract: async (args) => {
                          const wallet = await getWalletClient(config, { chainId: args.chain.id });
                          return wallet.deployContract(args);
                        },
                      },
                      evm.address,
                      requested,
                    );
                  },
                }
              : {
                  family: "solana",
                  address: solana.publicKey?.toBase58() ?? "",
                  submit: async (requested, metadataUri) => {
                    if (requested.mode === "bsc-erc20" || !solana.publicKey || !solana.signTransaction) {
                      throw new ChainLaunchError("WALLET_UNAVAILABLE", TX_ERROR_MESSAGES.WALLET_UNAVAILABLE, false);
                    }
                    return submitSolanaLaunch(
                      solanaConnection(requested.network),
                      { publicKey: solana.publicKey, signTransaction: solana.signTransaction },
                      requested,
                      metadataUri,
                    );
                  },
                },
        },
        launchApi,
        (step) => {
          update({ status: "running", step });
        },
      );
      update({ status: "success", deployment });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tokens.all() });
    } catch (error) {
      update({
        status: "error",
        message: error instanceof Error ? error.message : TX_ERROR_MESSAGES.UNKNOWN,
        deployment: error instanceof LaunchFlowError ? error.deployment : null,
      });
    }
  };

  return {
    view,
    launch,
    reset: () => {
      update({ status: "idle" });
    },
  };
}
