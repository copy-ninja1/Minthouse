import "@/polyfills";
import {
  type Connection,
  type Keypair,
  type PublicKey,
  type TransactionInstruction,
  type VersionedTransaction,
} from "@solana/web3.js";
import {
  fetchPumpProtocol,
  planPumpLaunch,
  PumpUnavailableError,
} from "@minthouse/blockchain/pump";
import {
  buildTransaction,
  classifySolanaError,
  estimatePriorityFee,
  planCreateSplToken,
  seedSplLiquidity,
  shouldSeedSplLiquidity,
  simulateTransaction,
  waitForSolanaConfirmation,
} from "@minthouse/blockchain/solana";
import {
  TX_ERROR_MESSAGES,
  getNetwork,
  type PumpfunConfig,
  type SplTokenConfig,
  type TokenConfig,
} from "@minthouse/shared";
import { ChainLaunchError } from "./chain-launch-error";

export type SolanaSigner = {
  publicKey: PublicKey;
  signTransaction: (
    transaction: VersionedTransaction,
  ) => Promise<VersionedTransaction>;
};

type SolanaLaunchConfig = Extract<
  TokenConfig,
  { mode: "solana-spl" | "pumpfun" }
>;

/** Floor so mainnet launches still land when the fee estimator returns 0. */
const MAINNET_MIN_PRIORITY_MICRO_LAMPORTS = 100_000;

function refused(error: unknown): ChainLaunchError {
  if (error instanceof ChainLaunchError) {
    return error;
  }
  if (error instanceof PumpUnavailableError || error instanceof RangeError) {
    return new ChainLaunchError("UNKNOWN", error.message, false, {
      cause: error,
    });
  }
  const classified = classifySolanaError(error);
  // This only runs before sendRawTransaction. A failure here never left the browser.
  return new ChainLaunchError(classified.code, classified.message, false, {
    cause: error,
  });
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
      return planPumpLaunch(await fetchPumpProtocol(connection), {
        creator,
        config,
        metadataUri,
      });
    default: {
      const exhaustive: never = config;
      throw new Error(`Unhandled Solana launch mode ${String(exhaustive)}`);
    }
  }
}

async function priorityFeeFor(
  connection: Connection,
  networkId: SolanaLaunchConfig["network"],
  accounts: PublicKey[],
): Promise<number> {
  const estimated = await estimatePriorityFee(connection, accounts).catch(
    () => 0,
  );
  const network = getNetwork(networkId);
  if (network.family === "solana" && network.isMainnet) {
    return Math.max(estimated, MAINNET_MIN_PRIORITY_MICRO_LAMPORTS);
  }
  return estimated;
}

/**
 * Builds, simulates, and asks the wallet to sign one Solana launch.
 * The fresh mint keypair co-signs after the wallet and is then discarded.
 *
 * The signing blockhash is fetched immediately before the wallet prompt so a
 * slow approval is less likely to expire the transaction.
 */
export async function submitSolanaLaunch(
  connection: Connection,
  signer: SolanaSigner,
  config: SolanaLaunchConfig,
  metadataUri: string,
): Promise<{
  txId: string;
  tokenAddress: string;
  lastValidBlockHeight: number;
}> {
  try {
    const plan = await planSolanaLaunch(
      connection,
      signer.publicKey,
      config,
      metadataUri,
    );
    const priorityFeeMicroLamports = await priorityFeeFor(
      connection,
      config.network,
      [signer.publicKey, plan.mint.publicKey],
    );

    // Simulate against a throwaway blockhash (RPC replaces it). The signed
    // transaction below gets a fresh blockhash immediately before approval.
    const forSimulation = await buildTransaction(
      connection,
      signer.publicKey,
      plan.instructions,
      { priorityFeeMicroLamports },
    );
    const simulation = await simulateTransaction(
      connection,
      forSimulation,
      signer.publicKey,
    );
    if (!simulation.ok) {
      const classified = classifySolanaError(
        new Error(simulation.error ?? "simulation failed"),
        simulation.logs,
      );
      const code =
        classified.code === "UNKNOWN" ? "SIMULATION_FAILED" : classified.code;
      throw new ChainLaunchError(code, TX_ERROR_MESSAGES[code], false);
    }

    const prepared = await buildTransaction(
      connection,
      signer.publicKey,
      plan.instructions,
      { priorityFeeMicroLamports },
    );
    const signed = await signer.signTransaction(prepared.transaction);
    signed.sign([plan.mint]);
    try {
      const txId = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        maxRetries: 5,
      });
      const confirmation = await waitForSolanaConfirmation(connection, {
        signature: txId,
        lastValidBlockHeight: prepared.lastValidBlockHeight,
      });
      switch (confirmation.state) {
        case "confirmed":
        case "finalized":
          break;
        case "failed":
          throw new ChainLaunchError(
            "REVERTED",
            TX_ERROR_MESSAGES.REVERTED,
            true,
            { cause: new Error(confirmation.error) },
          );
        case "expired":
          throw new ChainLaunchError(
            "EXPIRED",
            TX_ERROR_MESSAGES.EXPIRED,
            true,
          );
        case "processing":
        case "unknown":
          throw new ChainLaunchError(
            "CONFIRMATION_TIMEOUT",
            TX_ERROR_MESSAGES.CONFIRMATION_TIMEOUT,
            true,
          );
        default: {
          const exhaustive: never = confirmation;
          throw new Error(`Unhandled confirmation ${String(exhaustive)}`);
        }
      }

      const submission = {
        txId,
        tokenAddress: plan.mint.publicKey.toBase58(),
        lastValidBlockHeight: prepared.lastValidBlockHeight,
      };

      // Without a pool, wallets show $0 and "market data not available".
      if (config.mode === "solana-spl" && shouldSeedSplLiquidity(config)) {
        try {
          await seedSplLiquidity(connection, signer, {
            mint: plan.mint.publicKey,
            config,
          });
        } catch (liquidityError) {
          const classified = classifySolanaError(liquidityError);
          const hint =
            classified.code === "RPC_FAILURE"
              ? " Your Solana RPC blocked an indexed read Raydium needs — set VITE_SOLANA_MAINNET_RPC_URL to a provider that allows getTokenAccountsByOwner (e.g. Helius), then add the pool on Raydium for this mint."
              : " Add SOL + token liquidity on Raydium so wallets can show a price and chart.";
          throw new ChainLaunchError(
            classified.code === "UNKNOWN" ? "UNKNOWN" : classified.code,
            `Token created at ${submission.tokenAddress}, but the Raydium pool failed (${classified.message}).${hint}`,
            true,
            { cause: liquidityError, submission },
          );
        }
      }

      return submission;
    } catch (error) {
      if (error instanceof ChainLaunchError) {
        throw error;
      }
      const classified = classifySolanaError(error, simulation.logs);
      // A preflight rejection never leaves this machine. A transport failure might have.
      const broadcast =
        classified.code !== "SIMULATION_FAILED" &&
        classified.code !== "INSUFFICIENT_FUNDS";
      throw new ChainLaunchError(
        classified.code,
        classified.message,
        broadcast,
        { cause: error },
      );
    }
  } catch (error) {
    throw refused(error);
  }
}
