import { SendTransactionError, TransactionExpiredBlockheightExceededError } from "@solana/web3.js";
import { TX_ERROR_MESSAGES, type TxErrorCode } from "@minthouse/shared";

export type ClassifiedSolanaError = { code: TxErrorCode; message: string; logs?: string[] };

/** SPL Token program error codes that mean "you don't hold this authority". */
const SPL_AUTHORITY_ERRORS = ["custom program error: 0x4", "custom program error: 0x5"];

const WALLET_ERROR_CODES: Record<string, TxErrorCode> = {
  WalletNotConnectedError: "WALLET_UNAVAILABLE",
  WalletNotReadyError: "WALLET_UNAVAILABLE",
  WalletDisconnectedError: "WALLET_UNAVAILABLE",
  WalletConnectionError: "WALLET_UNAVAILABLE",
};

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    return `${error.message} ${error.cause instanceof Error ? error.cause.message : ""}`;
  }
  return typeof error === "string" ? error : "";
}

/** Maps Solana wallet-adapter and RPC errors to stable codes and safe messages. */
export function classifySolanaError(error: unknown, logs: string[] = []): ClassifiedSolanaError {
  const result = (code: TxErrorCode): ClassifiedSolanaError => ({
    code,
    message: TX_ERROR_MESSAGES[code],
    ...(logs.length > 0 ? { logs } : {}),
  });
  const text = `${messageOf(error)} ${logs.join(" ")}`.toLowerCase();

  if (error instanceof Error && error.name in WALLET_ERROR_CODES) {
    return result(WALLET_ERROR_CODES[error.name] ?? "UNKNOWN");
  }
  if (
    (typeof error === "object" && error !== null && "code" in error && error.code === 4001) ||
    /user rejected|rejected the request|user declined|request rejected|transaction cancelled/.test(text)
  ) {
    return result("USER_REJECTED");
  }
  if (error instanceof TransactionExpiredBlockheightExceededError || /blockhash not found|block height exceeded/.test(text)) {
    return result("EXPIRED");
  }
  // TransactionError::AccountNotFound is only raised for a fee payer with no lamports.
  if (/insufficient lamports|insufficient ?funds|no record of a prior credit|accountnotfound/.test(text)) {
    return result("INSUFFICIENT_FUNDS");
  }
  if (SPL_AUTHORITY_ERRORS.some((code) => text.includes(code)) || /owner does not match/.test(text)) {
    return result("UNAUTHORIZED");
  }
  if (error instanceof SendTransactionError || /simulation failed/.test(text)) {
    return result("SIMULATION_FAILED");
  }
  if (/failed to fetch|fetch failed|network request failed|429|503|502|timed out|econnrefused/.test(text)) {
    return result("RPC_FAILURE");
  }
  return result("UNKNOWN");
}
