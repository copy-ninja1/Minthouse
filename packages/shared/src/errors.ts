export const TX_ERROR_CODES = [
  "USER_REJECTED",
  "WALLET_UNAVAILABLE",
  "WRONG_NETWORK",
  "WRONG_ACCOUNT",
  "INSUFFICIENT_FUNDS",
  "RPC_FAILURE",
  "SIMULATION_FAILED",
  "EXPIRED",
  "DROPPED",
  "REVERTED",
  "CONFIRMATION_TIMEOUT",
  "DUPLICATE_SUBMISSION",
  "VERIFICATION_FAILED",
  "UNAUTHORIZED",
  "SLIPPAGE_EXCEEDED",
  "UNKNOWN",
] as const;
export type TxErrorCode = (typeof TX_ERROR_CODES)[number];

export const TX_ERROR_MESSAGES: Record<TxErrorCode, string> = {
  USER_REJECTED: "You rejected the request in your wallet. Nothing was submitted.",
  WALLET_UNAVAILABLE: "The wallet is not available. Unlock it or reconnect and try again.",
  WRONG_NETWORK: "Your wallet is on a different network than the one selected here.",
  WRONG_ACCOUNT: "The active wallet account changed. Review the transaction again with the current account.",
  INSUFFICIENT_FUNDS: "The wallet does not have enough funds to pay for this transaction.",
  RPC_FAILURE: "The network RPC endpoint did not respond correctly. Try again shortly.",
  SIMULATION_FAILED: "The transaction failed simulation and was not sent.",
  EXPIRED: "The transaction expired before it was included. It can no longer land.",
  DROPPED: "The transaction was dropped or replaced and did not execute.",
  REVERTED: "The transaction was included but failed on-chain.",
  CONFIRMATION_TIMEOUT:
    "Confirmation is taking longer than expected. The transaction may still land — check its status before retrying.",
  DUPLICATE_SUBMISSION: "An identical operation is already in progress.",
  VERIFICATION_FAILED: "The transaction landed, but the resulting on-chain state did not match what was requested.",
  UNAUTHORIZED: "The connected wallet does not hold the authority required for this action.",
  SLIPPAGE_EXCEEDED: "The price moved beyond your slippage limit, so the program refused the trade. Nothing was traded; review the new quote.",
  UNKNOWN: "Something went wrong. Check the transaction status before trying again.",
};

/** A user-facing error with a stable classification code. */
export class TxError extends Error {
  override readonly name = "TxError";
  constructor(
    readonly code: TxErrorCode,
    message: string = TX_ERROR_MESSAGES[code],
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/** Codes after which the transaction is known not to have executed, so a fresh attempt is safe. */
export function isSafeToRetry(code: TxErrorCode): boolean {
  return (
    code === "USER_REJECTED" ||
    code === "WALLET_UNAVAILABLE" ||
    code === "WRONG_NETWORK" ||
    code === "WRONG_ACCOUNT" ||
    code === "INSUFFICIENT_FUNDS" ||
    code === "SIMULATION_FAILED" ||
    code === "EXPIRED" ||
    code === "DROPPED" ||
    code === "REVERTED" ||
    code === "UNAUTHORIZED" ||
    code === "SLIPPAGE_EXCEEDED"
  );
}
