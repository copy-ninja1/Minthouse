import {
  ComputeBudgetProgram,
  type Connection,
  type Keypair,
  type PublicKey,
  type SimulatedTransactionResponse,
  type TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

export type PreparedTransaction = {
  transaction: VersionedTransaction;
  blockhash: string;
  /** The transaction cannot land after this block height; used for reconciliation. */
  lastValidBlockHeight: number;
};

/** Upper bound on the priority fee this app will ever attach automatically (micro-lamports per CU). */
const MAX_PRIORITY_MICRO_LAMPORTS = 1_000_000;

/**
 * Median of recent prioritisation fees paid for the given writable accounts.
 * Returns 0 when the RPC has no data (common on devnet/localnet).
 */
export async function estimatePriorityFee(connection: Connection, writableAccounts: PublicKey[]): Promise<number> {
  const fees = await connection.getRecentPrioritizationFees({ lockedWritableAccounts: writableAccounts }).catch(() => []);
  const nonZero = fees.map((fee) => fee.prioritizationFee).filter((fee) => fee > 0).sort((a, b) => a - b);
  if (nonZero.length === 0) {
    return 0;
  }
  return Math.min(nonZero[Math.floor(nonZero.length / 2)] ?? 0, MAX_PRIORITY_MICRO_LAMPORTS);
}

export type BuildOptions = {
  priorityFeeMicroLamports?: number;
  computeUnitLimit?: number;
  /** Additional signers known to the application (e.g. a freshly generated mint keypair). */
  signers?: Keypair[];
};

/**
 * Builds an unsigned v0 transaction with a fresh blockhash. Application-held
 * signers (never user keys) sign after the wallet so wallets see the
 * transaction exactly as built.
 */
export async function buildTransaction(
  connection: Connection,
  payer: PublicKey,
  instructions: TransactionInstruction[],
  options: BuildOptions = {},
): Promise<PreparedTransaction> {
  const budget: TransactionInstruction[] = [];
  if (options.computeUnitLimit) {
    budget.push(ComputeBudgetProgram.setComputeUnitLimit({ units: options.computeUnitLimit }));
  }
  if (options.priorityFeeMicroLamports && options.priorityFeeMicroLamports > 0) {
    budget.push(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: Math.min(options.priorityFeeMicroLamports, MAX_PRIORITY_MICRO_LAMPORTS),
      }),
    );
  }
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: [...budget, ...instructions],
  }).compileToV0Message();
  return { transaction: new VersionedTransaction(message), blockhash, lastValidBlockHeight };
}

export type SimulationResult = {
  ok: boolean;
  error: string | null;
  logs: string[];
  unitsConsumed: number | null;
  /** Lamports the payer is expected to spend, including rent deposits and protocol fees, excluding the base fee. */
  payerLamportsDelta: bigint | null;
  /** Network fee for this message as reported by the RPC. */
  networkFeeLamports: bigint | null;
};

/**
 * Simulates without signatures and measures the payer's balance change, so
 * rent deposits and program-charged fees are measured rather than guessed.
 */
export async function simulateTransaction(
  connection: Connection,
  prepared: PreparedTransaction,
  payer: PublicKey,
): Promise<SimulationResult> {
  const [before, simulation, fee] = await Promise.all([
    connection.getBalance(payer, "confirmed"),
    connection.simulateTransaction(prepared.transaction, {
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: "confirmed",
      accounts: { addresses: [payer.toBase58()], encoding: "base64" },
    }),
    connection.getFeeForMessage(prepared.transaction.message, "confirmed").catch(() => ({ value: null })),
  ]);
  return toSimulationResult(simulation.value, before, fee.value);
}

function toSimulationResult(
  value: SimulatedTransactionResponse,
  payerBalanceBefore: number,
  networkFee: number | null,
): SimulationResult {
  const after = value.accounts?.[0]?.lamports;
  return {
    ok: value.err === null,
    error: value.err === null ? null : JSON.stringify(value.err),
    logs: value.logs ?? [],
    unitsConsumed: value.unitsConsumed ?? null,
    payerLamportsDelta: after === undefined ? null : BigInt(payerBalanceBefore) - BigInt(after),
    networkFeeLamports: networkFee === null ? null : BigInt(networkFee),
  };
}
