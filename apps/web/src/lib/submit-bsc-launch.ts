import { type Address, type Hash, type PublicClient, getAddress, getContractAddress } from "viem";
import { buildLaunchpadDeployment, classifyEvmError } from "@minthouse/blockchain/bsc";
import { type BscTokenConfig, getEvmNetwork, toChecksumAddress } from "@minthouse/shared";
import { ChainLaunchError } from "./chain-launch-error";
import { evmChain } from "./rpc";

export type EvmDeployer = {
  chainId: number | undefined;
  /** Switches the wallet onto `chainId` before the deployment is signed. */
  switchChain: (chainId: number) => Promise<void>;
  deployContract: (args: {
    abi: ReturnType<typeof buildLaunchpadDeployment>["abi"];
    bytecode: ReturnType<typeof buildLaunchpadDeployment>["bytecode"];
    args: ReturnType<typeof buildLaunchpadDeployment>["args"];
    account: Address;
    chain: ReturnType<typeof evmChain>;
    nonce: number;
  }) => Promise<Hash>;
};

function refused(error: unknown): ChainLaunchError {
  if (error instanceof ChainLaunchError) {
    return error;
  }
  const classified = classifyEvmError(error);
  return new ChainLaunchError(classified.code, classified.message, false, { cause: error });
}

async function readSubmittedNonce(client: PublicClient, hash: Hash, fallbackNonce: number, fallbackFrom: Address): Promise<{ nonce: number; from: Address }> {
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
 * Asks the wallet to deploy LaunchpadToken. The contract address is the
 * CREATE address for the nonce the wallet actually used.
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
    const nonce = await client.getTransactionCount({ address: account, blockTag: "pending" });
    const deployment = buildLaunchpadDeployment(config);
    const txId = await deployer.deployContract({
      abi: deployment.abi,
      bytecode: deployment.bytecode,
      args: deployment.args,
      account,
      chain: evmChain(config.network),
      nonce,
    });
    const submitted = await readSubmittedNonce(client, txId, nonce, account);
    const tokenAddress = getContractAddress({ from: submitted.from, nonce: BigInt(submitted.nonce) });
    return { txId, tokenAddress, evmNonce: submitted.nonce };
  } catch (error) {
    throw refused(error);
  }
}
