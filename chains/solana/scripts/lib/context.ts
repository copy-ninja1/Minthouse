import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { Connection, Keypair, PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { z } from "zod";
import { solanaConnectionEnvSchema } from "@minthouse/config";
import { parseCliEnv, requireTypedConfirmation } from "@minthouse/config/cli";
import { type NetworkId, type SolanaNetwork, formatTokenAmount, getSolanaNetwork, solanaAddressField } from "@minthouse/shared";
import {
  buildTransaction,
  classifySolanaError,
  estimatePriorityFee,
  simulateTransaction,
  waitForSolanaConfirmation,
} from "@minthouse/blockchain/solana";

const CLUSTER_TO_NETWORK: Record<string, NetworkId> = {
  localnet: "solana-local",
  devnet: "solana-devnet",
  "mainnet-beta": "solana-mainnet",
};

export type SolanaScriptContext = {
  connection: Connection;
  network: SolanaNetwork;
  signer: Keypair;
};

async function loadKeypair(file: string): Promise<Keypair> {
  const resolved = file.startsWith("~/") ? `${homedir()}${file.slice(1)}` : file;
  const raw = await readFile(resolved, "utf8").catch(() => {
    throw new Error(`Cannot read keypair file ${resolved}. Set SOLANA_KEYPAIR_PATH.`);
  });
  const bytes = z.array(z.number().int().min(0).max(255)).length(64).parse(JSON.parse(raw));
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

/**
 * Connects to the configured cluster and verifies the RPC endpoint really
 * serves that cluster by comparing genesis hashes for public clusters.
 */
export async function connect(): Promise<SolanaScriptContext> {
  const clusterFlag = process.argv.find((arg) => arg.startsWith("--cluster="))?.slice("--cluster=".length);
  if (clusterFlag) {
    process.env.SOLANA_CLUSTER = clusterFlag;
  }
  const env = parseCliEnv(solanaConnectionEnvSchema);
  const network = getSolanaNetwork(CLUSTER_TO_NETWORK[env.SOLANA_CLUSTER] ?? "solana-devnet");
  const connection = new Connection(env.SOLANA_RPC_URL ?? network.defaultRpcUrl, "confirmed");
  const genesis = await connection.getGenesisHash();
  const expectedGenesis = GENESIS_HASHES[network.cluster];
  if (expectedGenesis && genesis !== expectedGenesis) {
    throw new Error(`RPC endpoint is not ${network.label} (genesis ${genesis}). Check SOLANA_RPC_URL and SOLANA_CLUSTER.`);
  }
  return { connection, network, signer: await loadKeypair(env.SOLANA_KEYPAIR_PATH) };
}

const GENESIS_HASHES: Partial<Record<SolanaNetwork["cluster"], string>> = {
  "mainnet-beta": "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
};

export function explorerTx(context: SolanaScriptContext, signature: string): string {
  return context.network.explorer?.transaction(signature) ?? signature;
}

export function explorerAddress(context: SolanaScriptContext, address: string): string {
  return context.network.explorer?.address(address) ?? address;
}

export const solanaAddress = solanaAddressField.transform((value) => new PublicKey(value));

export function printSummary(title: string, summary: Record<string, string>): void {
  console.log(`\n${title}`);
  for (const [key, value] of Object.entries(summary)) {
    console.log(`  ${key.padEnd(22)} ${value}`);
  }
}

export type SendOptions = {
  title: string;
  summary: Record<string, string>;
  instructions: TransactionInstruction[];
  /** Additional application signers, e.g. a new mint keypair. */
  extraSigners?: Keypair[];
  irreversible?: { phrase: string; warning: string };
};

/**
 * Simulates, confirms where required, signs, sends, and waits until the
 * signature is confirmed or provably expired. Returns the signature.
 */
export async function simulateConfirmAndSend(context: SolanaScriptContext, options: SendOptions): Promise<string> {
  const { connection, signer, network } = context;
  const priorityFee = network.isMainnet ? await estimatePriorityFee(connection, [signer.publicKey]) : 0;
  const prepared = await buildTransaction(connection, signer.publicKey, options.instructions, {
    priorityFeeMicroLamports: priorityFee,
  });
  const simulation = await simulateTransaction(connection, prepared, signer.publicKey);
  if (!simulation.ok) {
    const classified = classifySolanaError(new Error(simulation.error ?? "simulation failed"), simulation.logs);
    const detail = [`(${simulation.error ?? "no error detail"})`, ...simulation.logs.slice(-6)].join("\n");
    throw new Error(`Simulation failed — nothing was sent. ${classified.message}\n${detail}`);
  }
  const summary = {
    Network: network.label,
    Signer: signer.publicKey.toBase58(),
    ...options.summary,
    "Estimated cost": simulation.payerLamportsDelta === null
      ? "unavailable"
      : `${formatSol(simulation.payerLamportsDelta + (simulation.networkFeeLamports ?? 0n))} SOL (simulation estimate, incl. rent deposits)`,
  };

  if (options.irreversible) {
    await requireTypedConfirmation({ title: options.title, summary, ...options.irreversible });
  } else if (network.isMainnet) {
    await requireTypedConfirmation({
      title: options.title,
      summary,
      phrase: `${options.title.toLowerCase()} on ${network.id}`,
      warning: "This is a Solana MAINNET transaction and spends real SOL.",
    });
  } else {
    printSummary(options.title, summary);
  }

  prepared.transaction.sign([signer, ...(options.extraSigners ?? [])]);
  const signature = await connection.sendRawTransaction(prepared.transaction.serialize(), { maxRetries: 5 });
  console.log(`\nSubmitted: ${explorerTx(context, signature)}`);
  const result = await waitForSolanaConfirmation(connection, { signature, lastValidBlockHeight: prepared.lastValidBlockHeight });
  switch (result.state) {
    case "confirmed":
    case "finalized":
      console.log(`Confirmed in slot ${result.slot}.`);
      return signature;
    case "failed":
      throw new Error(`Transaction failed on-chain: ${result.error}`);
    case "expired":
      throw new Error("Transaction expired before landing. It did not execute; it is safe to retry.");
    case "processing":
    case "unknown":
      throw new Error(`Outcome unknown. Check ${explorerTx(context, signature)} before retrying.`);
    default: {
      const exhaustive: never = result;
      throw new Error(`Unhandled state ${JSON.stringify(exhaustive)}`);
    }
  }
}

export function formatSol(lamports: bigint): string {
  return formatTokenAmount(lamports, 9);
}
