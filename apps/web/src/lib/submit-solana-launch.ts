import "@/polyfills";
import { type Connection, type Keypair, type PublicKey, type TransactionInstruction, type VersionedTransaction } from "@solana/web3.js";
import { fetchPumpProtocol, planPumpLaunch, PumpUnavailableError } from "@minthouse/blockchain/pump";
import {
  buildTransaction,
  classifySolanaError,
  estimatePriorityFee,
  planCreateSplToken,
  simulateTransaction,
} from "@minthouse/blockchain/solana";
import { TX_ERROR_MESSAGES, type PumpfunConfig, type SplTokenConfig, type TokenConfig } from "@minthouse/shared";
import { ChainLaunchError } from "./chain-launch-error";

export type SolanaSigner = {
  publicKey: PublicKey;
  signTransaction: (transaction: VersionedTransaction) => Promise<VersionedTransaction>;
};

type SolanaLaunchConfig = Extract<TokenConfig, { mode: "solana-spl" | "pumpfun" }>;

function refused(error: unknown): ChainLaunchError {
  if (error instanceof ChainLaunchError) {
    return error;
  }
  if (error instanceof PumpUnavailableError || error instanceof RangeError) {
    return new ChainLaunchError("UNKNOWN", error.message, false, { cause: error });
  }
  const classified = classifySolanaError(error);
  const broadcast = classified.code === "RPC_FAILURE" || classified.code === "UNKNOWN";
  return new ChainLaunchError(classified.code, classified.message, broadcast, { cause: error });
}

async function planSolanaLaunch(
  connection: Connection,
  creator: PublicKey,
  config: SplTokenConfig | PumpfunConfig,
  metadataUri: string,
): Promise<{ mint: Keypair; instructions: TransactionInstruction[] }> {
  switch (config.mode) {
    case "solana-spl":
      return planCreateSplToken(connection, { creator, config, metadataUri });
    case "pumpfun":
      return planPumpLaunch(await fetchPumpProtocol(connection), { creator, config, metadataUri });
    default: {
      const exhaustive: never = config;
      throw new Error(`Unhandled Solana launch mode ${String(exhaustive)}`);
    }
  }
}

/**
 * Builds, simulates, and asks the wallet to sign one Solana launch.
 * The fresh mint keypair co-signs after the wallet and is then discarded.
 */
export async function submitSolanaLaunch(
  connection: Connection,
  signer: SolanaSigner,
  config: SolanaLaunchConfig,
  metadataUri: string,
): Promise<{ txId: string; tokenAddress: string; lastValidBlockHeight: number }> {
  try {
    const plan = await planSolanaLaunch(connection, signer.publicKey, config, metadataUri);
    const priorityFeeMicroLamports = await estimatePriorityFee(connection, [signer.publicKey, plan.mint.publicKey]).catch(() => 0);
    const prepared = await buildTransaction(connection, signer.publicKey, plan.instructions, { priorityFeeMicroLamports });
    const simulation = await simulateTransaction(connection, prepared, signer.publicKey);
    if (!simulation.ok) {
      throw new ChainLaunchError("SIMULATION_FAILED", TX_ERROR_MESSAGES.SIMULATION_FAILED, false);
    }

    const signed = await signer.signTransaction(prepared.transaction);
    signed.sign([plan.mint]);
    try {
      const txId = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 });
      return { txId, tokenAddress: plan.mint.publicKey.toBase58(), lastValidBlockHeight: prepared.lastValidBlockHeight };
    } catch (error) {
      const classified = classifySolanaError(error, simulation.logs);
      // A preflight rejection never leaves this machine. A transport failure might have.
      const broadcast = classified.code !== "SIMULATION_FAILED" && classified.code !== "INSUFFICIENT_FUNDS";
      throw new ChainLaunchError(classified.code, classified.message, broadcast, { cause: error });
    }
  } catch (error) {
    throw refused(error);
  }
}
