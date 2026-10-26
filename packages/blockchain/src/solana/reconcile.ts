import type { Connection } from "@solana/web3.js";

export type SolanaTxState =
  | { state: "finalized" | "confirmed"; slot: number }
  | { state: "failed"; slot: number; error: string }
  | { state: "processing" }
  /** Not found and its blockhash has expired: it can never land, so a retry is safe. */
  | { state: "expired" }
  /** Not found but still within its validity window: the outcome is not yet known. */
  | { state: "unknown" };

/**
 * Determines the outcome of a signature after an interruption. A missing
 * signature is only treated as expired once the cluster's block height has
 * passed the transaction's `lastValidBlockHeight`.
 */
export async function reconcileSolanaSignature(
  connection: Connection,
  params: { signature: string; lastValidBlockHeight?: number },
): Promise<SolanaTxState> {
  const { value } = await connection.getSignatureStatuses([params.signature], { searchTransactionHistory: true });
  const status = value[0];
  if (status) {
    if (status.err) {
      return { state: "failed", slot: status.slot, error: JSON.stringify(status.err) };
    }
    if (status.confirmationStatus === "finalized") {
      return { state: "finalized", slot: status.slot };
    }
    if (status.confirmationStatus === "confirmed") {
      return { state: "confirmed", slot: status.slot };
    }
    return { state: "processing" };
  }
  if (params.lastValidBlockHeight !== undefined) {
    const height = await connection.getBlockHeight("confirmed");
    if (height > params.lastValidBlockHeight) {
      // Check once more: the transaction may have landed between the two calls.
      const recheck = await connection.getSignatureStatuses([params.signature], { searchTransactionHistory: true });
      if (!recheck.value[0]) {
        return { state: "expired" };
      }
      return reconcileSolanaSignature(connection, { signature: params.signature });
    }
  }
  return { state: "unknown" };
}

export type ConfirmOptions = {
  signature: string;
  lastValidBlockHeight: number;
  /** Polling interval in milliseconds. */
  intervalMs?: number;
  signal?: AbortSignal;
};

/**
 * Polls until the signature reaches `confirmed`, fails, or provably expires.
 * Uses polling rather than websockets so it works with any RPC endpoint.
 */
export async function waitForSolanaConfirmation(connection: Connection, options: ConfirmOptions): Promise<SolanaTxState> {
  const interval = options.intervalMs ?? 1_500;
  for (;;) {
    options.signal?.throwIfAborted();
    const result = await reconcileSolanaSignature(connection, options);
    if (result.state !== "processing" && result.state !== "unknown") {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}
