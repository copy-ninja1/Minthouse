import { useWallet } from "@solana/wallet-adapter-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getWalletClient, switchChain } from "wagmi/actions";
import { useConfig, useConnection } from "wagmi";
import {
  getEvmNetwork,
  getNetwork,
  TX_ERROR_MESSAGES,
  type Deployment,
  type TokenConfig,
} from "@minthouse/shared";
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
import {
  type LaunchStep,
  type TokenDeployer,
  LaunchFlowError,
  launchToken,
} from "@/lib/launch-token";
import { type LaunchSecret, readLaunchSecret } from "@/lib/launch-signer";
import { evmPublicClient, rpcUrl, solanaConnection } from "@/lib/rpc";
import { submitBscLaunch } from "@/lib/submit-bsc-launch";
import { submitSolanaLaunch } from "@/lib/submit-solana-launch";

export type LaunchView =
  | { status: "idle" }
  | { status: "running"; step: LaunchStep }
  | { status: "success"; deployment: Deployment }
  | { status: "error"; message: string; deployment: Deployment | null };

const INVALID_LAUNCH_SECRET =
  "That private key is not valid for this chain. Paste the key, not a seed phrase.";

const launchApi = {
  uploadLogo: (file: File) => uploadLogo(file),
  publishMetadata: (body: Parameters<typeof publishMetadata>[0]) =>
    publishMetadata(body),
  createDeployment: (body: Parameters<typeof createDeployment>[0]) =>
    createDeployment(body),
  recordSubmission: (
    id: string,
    body: Parameters<typeof recordSubmission>[1],
  ) => recordSubmission(id, body),
  cancelDeployment: (
    id: string,
    body: Parameters<typeof cancelDeployment>[1],
  ) => cancelDeployment(id, body),
  getDeployment: (id: string) => getDeployment(id),
};

function redactSecret(message: string, secret: string | undefined): string {
  const trimmed = secret?.trim();
  if (!trimmed || trimmed.length < 8 || !message.includes(trimmed)) {
    return message;
  }
  return TX_ERROR_MESSAGES.UNKNOWN;
}

/**
 * Runs one launch and keeps the visible step in state.
 * A pasted private key signs in the browser. Otherwise the connected wallet signs.
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

  const bscWalletDeployer = (): TokenDeployer => ({
    family: "bsc",
    address: evm.address ?? "",
    submit: async (requested) => {
      if (requested.mode !== "bsc-erc20") {
        throw new ChainLaunchError(
          "UNKNOWN",
          "This token is not a BNB Smart Chain launch.",
          false,
        );
      }
      if (!evm.address) {
        throw new ChainLaunchError(
          "WALLET_UNAVAILABLE",
          TX_ERROR_MESSAGES.WALLET_UNAVAILABLE,
          false,
        );
      }
      return submitBscLaunch(
        evmPublicClient(requested.network),
        {
          chainId: evm.chainId,
          switchChain: async (chainId) => {
            await switchChain(config, { chainId });
          },
          walletClient: async (chain) => {
            const wallet = await getWalletClient(config, {
              chainId: chain.id,
            });
            if (!wallet) {
              throw new ChainLaunchError(
                "WALLET_UNAVAILABLE",
                TX_ERROR_MESSAGES.WALLET_UNAVAILABLE,
                false,
              );
            }
            return wallet;
          },
        },
        evm.address,
        requested,
      );
    },
  });

  const bscKeyDeployer = (
    launchSecret: Extract<LaunchSecret, { family: "bsc" }>,
  ): TokenDeployer => ({
    family: "bsc",
    address: launchSecret.address,
    submit: async (requested) => {
      if (requested.mode !== "bsc-erc20") {
        throw new ChainLaunchError(
          "UNKNOWN",
          "This token is not a BNB Smart Chain launch.",
          false,
        );
      }
      const account = privateKeyToAccount(launchSecret.privateKey);
      const chainId = getEvmNetwork(requested.network).chainId;
      return submitBscLaunch(
        evmPublicClient(requested.network),
        {
          chainId,
          switchChain: () => Promise.resolve(),
          walletClient: async (chain) =>
            createWalletClient({
              account,
              chain,
              transport: http(rpcUrl(requested.network)),
            }),
        },
        account.address,
        requested,
      );
    },
  });

  const solanaWalletDeployer = (): TokenDeployer => ({
    family: "solana",
    address: solana.publicKey?.toBase58() ?? "",
    submit: async (requested, metadataUri) => {
      if (
        requested.mode === "bsc-erc20" ||
        !solana.publicKey ||
        !solana.signTransaction
      ) {
        throw new ChainLaunchError(
          "WALLET_UNAVAILABLE",
          TX_ERROR_MESSAGES.WALLET_UNAVAILABLE,
          false,
        );
      }
      return submitSolanaLaunch(
        solanaConnection(requested.network),
        {
          publicKey: solana.publicKey,
          signTransaction: solana.signTransaction,
        },
        requested,
        metadataUri,
      );
    },
  });

  const solanaKeyDeployer = (
    launchSecret: Extract<LaunchSecret, { family: "solana" }>,
  ): TokenDeployer => ({
    family: "solana",
    address: launchSecret.address,
    submit: async (requested, metadataUri) => {
      if (requested.mode === "bsc-erc20") {
        throw new ChainLaunchError(
          "UNKNOWN",
          "This token is not a Solana launch.",
          false,
        );
      }
      return submitSolanaLaunch(
        solanaConnection(requested.network),
        {
          publicKey: launchSecret.keypair.publicKey,
          signTransaction: (transaction) => {
            transaction.sign([launchSecret.keypair]);
            return Promise.resolve(transaction);
          },
        },
        requested,
        metadataUri,
      );
    },
  });

  const deployerFor = (
    family: "bsc" | "solana",
    launchSecret: LaunchSecret | null,
  ): TokenDeployer => {
    if (launchSecret?.family === "bsc") {
      return bscKeyDeployer(launchSecret);
    }
    if (launchSecret?.family === "solana") {
      return solanaKeyDeployer(launchSecret);
    }
    switch (family) {
      case "bsc":
        return bscWalletDeployer();
      case "solana":
        return solanaWalletDeployer();
      default: {
        const exhaustive: never = family;
        throw new Error(`Unhandled chain family ${String(exhaustive)}`);
      }
    }
  };

  const launch = async (token: TokenConfig, logo: File, secret?: string) => {
    const family = getNetwork(token.network).family;
    const launchSecret = secret ? readLaunchSecret(family, secret) : null;
    if (secret && !launchSecret) {
      update({
        status: "error",
        message: INVALID_LAUNCH_SECRET,
        deployment: null,
      });
      return;
    }
    update({ status: "running", step: "publish" });
    try {
      const deployment = await launchToken(
        {
          config: token,
          logo,
          deployer: deployerFor(family, launchSecret),
        },
        launchApi,
        (step) => {
          update({ status: "running", step });
        },
      );
      update({ status: "success", deployment });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tokens.all() });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : TX_ERROR_MESSAGES.UNKNOWN;
      update({
        status: "error",
        message: redactSecret(message, secret),
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
