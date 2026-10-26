import { network } from "hardhat";
import { getAddress } from "viem";
import { findEvmNetworkByChainId, type EvmNetwork } from "@minthouse/shared";

export type ScriptContext = Awaited<ReturnType<typeof connect>>;

/**
 * Connects to the network selected with `--network` and identifies it by the
 * chain id reported by the RPC endpoint, never by the configured name alone.
 */
export async function connect() {
  const connection = await network.create();
  const { viem } = connection;
  const publicClient = await viem.getPublicClient();
  const wallets = await viem.getWalletClients();
  const chainId = await publicClient.getChainId();
  const known: EvmNetwork | undefined = findEvmNetworkByChainId(chainId);
  if (!known) {
    throw new Error(`Unsupported chain id ${chainId} on network "${connection.networkName}"`);
  }
  if (connection.networkConfig.chainId !== undefined && connection.networkConfig.chainId !== chainId) {
    throw new Error(
      `RPC reports chain id ${chainId}, but network "${connection.networkName}" is configured for ${connection.networkConfig.chainId}`,
    );
  }
  const wallet = wallets[0];
  return {
    viem,
    publicClient,
    wallet,
    chainId,
    network: known,
    networkName: connection.networkName,
    isMainnet: known.isMainnet,
    /** Blocks to wait before treating a transaction as final for script output. */
    confirmations: known.isMainnet ? 3 : 1,
  };
}

/** Returns the signer and its checksummed address, which is what contract reads return for comparison. */
export function requireWallet(context: ScriptContext) {
  if (!context.wallet) {
    throw new Error(`No signer configured for "${context.networkName}". Set the network's private key configuration variable.`);
  }
  return { wallet: context.wallet, signer: getAddress(context.wallet.account.address) };
}

export function explorerTx(context: ScriptContext, hash: string): string {
  return context.network.explorer?.transaction(hash) ?? hash;
}

export function explorerAddress(context: ScriptContext, address: string): string {
  return context.network.explorer?.address(address) ?? address;
}
