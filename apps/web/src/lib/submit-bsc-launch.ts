import {
  type Address,
  type Hash,
  type PublicClient,
  type WalletClient,
  getAddress,
  getContractAddress,
} from "viem";
import {
  buildLaunchpadDeployment,
  classifyEvmError,
  seedBscLiquidity,
  shouldSeedBscLiquidity,
} from "@minthouse/blockchain/bsc";
import {
  type BscTokenConfig,
  getEvmNetwork,
  toChecksumAddress,
} from "@minthouse/shared";
import { ChainLaunchError } from "./chain-launch-error";
import { evmChain } from "./rpc";

export type EvmDeployer = {
  chainId: number | undefined;
  /** Switches the wallet onto `chainId` before the deployment is signed. */
  switchChain: (chainId: number) => Promise<void>;
  /** Wallet used to deploy and, when configured, seed PancakeSwap liquidity. */
  walletClient: (
    chain: ReturnType<typeof evmChain>,
  ) => Promise<WalletClient>;
};

function refused(error: unknown): ChainLaunchError {
  if (error instanceof ChainLaunchError) {
    return error;
  }
  const classified = classifyEvmError(error);
  return new ChainLaunchError(classified.code, classified.message, false, {
    cause: error,
  });
}

async function readSubmittedNonce(
  client: PublicClient,
  hash: Hash,
  fallbackNonce: number,
  fallbackFrom: Address,
): Promise<{ nonce: number; from: Address }> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const transaction = await client.getTransaction({ hash });
      return { nonce: transaction.nonce, from: getAddress(transaction.from) };
    } catch {
      if (attempt === 4) {
        return { nonce: fallbackNonce, from: fallbackFrom };
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 400 * (attempt + 1));
      });
    }
  }
  return { nonce: fallbackNonce, from: fallbackFrom };
}

/**
 * Deploys LaunchpadToken, then optionally seeds a PancakeSwap V2 pool so
 * wallets can show a dollar price. The contract address is the CREATE address
 * for the nonce the wallet actually used.
 */
export async function submitBscLaunch(
  client: PublicClient,
  deployer: EvmDeployer,
  creator: Address,
  config: BscTokenConfig,
): Promise<{ txId: Hash; tokenAddress: string; evmNonce: number }> {
  const expectedChainId = getEvmNetwork(config.network).chainId;
  try {
    if (deployer.chainId !== expectedChainId) {
      await deployer.switchChain(expectedChainId);
    }
    const account = toChecksumAddress(creator);
    const chain = evmChain(config.network);
    const wallet = await deployer.walletClient(chain);
    const nonce = await client.getTransactionCount({
      address: account,
      blockTag: "pending",
    });
    const deployment = buildLaunchpadDeployment(config);
    const txId = await wallet.deployContract({
      abi: deployment.abi,
      bytecode: deployment.bytecode,
      args: deployment.args,
      account,
      chain,
      nonce,
    });
    const submitted = await readSubmittedNonce(client, txId, nonce, account);
    const tokenAddress = getContractAddress({
      from: submitted.from,
      nonce: BigInt(submitted.nonce),
    });
    await client.waitForTransactionReceipt({ hash: txId });
    const submission = {
      txId,
      tokenAddress,
      evmNonce: submitted.nonce,
    };

    if (shouldSeedBscLiquidity(config)) {
      if (getAddress(config.recipient) !== getAddress(account)) {
        throw new ChainLaunchError(
          "UNKNOWN",
          `Token created at ${tokenAddress}, but liquidity needs the recipient to be the signing account. Add BNB + token liquidity on PancakeSwap so wallets can show a price.`,
          true,
          { submission },
        );
      }
      try {
        await seedBscLiquidity({
          publicClient: client,
          walletClient: wallet,
          account,
          tokenAddress,
          config,
        });
      } catch (liquidityError) {
        const detail =
          liquidityError instanceof Error
            ? liquidityError.message
            : "unknown error";
        throw new ChainLaunchError(
          "UNKNOWN",
          `Token created at ${tokenAddress}, but the PancakeSwap pool failed (${detail}). Add BNB + token liquidity on PancakeSwap so wallets can show a price and chart.`,
          true,
          { cause: liquidityError, submission },
        );
      }
    }

    return submission;
  } catch (error) {
    throw refused(error);
  }
}
