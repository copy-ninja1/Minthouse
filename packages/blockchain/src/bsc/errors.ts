import {
  BaseError,
  ChainMismatchError,
  ContractFunctionRevertedError,
  HttpRequestError,
  InsufficientFundsError,
  TimeoutError,
  UserRejectedRequestError,
  WaitForTransactionReceiptTimeoutError,
} from "viem";
import { TX_ERROR_MESSAGES, type TxErrorCode } from "@minthouse/shared";

const UNAUTHORIZED_REVERTS = new Set(["OwnableUnauthorizedAccount", "MintingIsDisabled"]);

/** Error names thrown by wagmi connectors, matched by name to avoid a wagmi dependency here. */
const CONNECTOR_ERRORS: Record<string, TxErrorCode> = {
  ConnectorChainMismatchError: "WRONG_NETWORK",
  ConnectorAccountNotFoundError: "WRONG_ACCOUNT",
  ConnectorNotConnectedError: "WALLET_UNAVAILABLE",
  ProviderNotFoundError: "WALLET_UNAVAILABLE",
  ProviderDisconnectedError: "WALLET_UNAVAILABLE",
  ChainDisconnectedError: "WALLET_UNAVAILABLE",
};

function hasCode(value: unknown, code: number): boolean {
  return typeof value === "object" && value !== null && "code" in value && value.code === code;
}

export type ClassifiedError = { code: TxErrorCode; message: string; revertReason?: string };

/** Maps any EVM wallet/RPC error to a stable code and a safe user-facing message. */
export function classifyEvmError(error: unknown): ClassifiedError {
  const named = (code: TxErrorCode, detail?: string): ClassifiedError => ({
    code,
    message: detail ? `${TX_ERROR_MESSAGES[code]} (${detail})` : TX_ERROR_MESSAGES[code],
  });

  if (error instanceof Error && error.name in CONNECTOR_ERRORS) {
    return named(CONNECTOR_ERRORS[error.name] ?? "UNKNOWN");
  }
  if (hasCode(error, 4001)) {
    return named("USER_REJECTED");
  }
  if (!(error instanceof BaseError)) {
    return named("UNKNOWN");
  }

  const find = <T extends Error>(type: abstract new (...args: never[]) => T): T | null =>
    error.walk((inner) => inner instanceof type) as T | null;

  if (find(UserRejectedRequestError) || error.walk((inner) => hasCode(inner, 4001))) {
    return named("USER_REJECTED");
  }
  if (find(ChainMismatchError)) {
    return named("WRONG_NETWORK");
  }
  if (find(InsufficientFundsError)) {
    return named("INSUFFICIENT_FUNDS");
  }
  const reverted = find(ContractFunctionRevertedError);
  if (reverted) {
    const reason = reverted.data?.errorName ?? reverted.reason ?? undefined;
    if (reason && UNAUTHORIZED_REVERTS.has(reason)) {
      return { ...named("UNAUTHORIZED", reason), revertReason: reason };
    }
    return { ...named("SIMULATION_FAILED", reason), ...(reason ? { revertReason: reason } : {}) };
  }
  if (find(WaitForTransactionReceiptTimeoutError)) {
    return named("CONFIRMATION_TIMEOUT");
  }
  if (find(HttpRequestError) || find(TimeoutError)) {
    return named("RPC_FAILURE");
  }
  for (const [name, code] of Object.entries(CONNECTOR_ERRORS)) {
    if (error.walk((inner) => inner instanceof Error && inner.name === name)) {
      return named(code);
    }
  }
  return named("UNKNOWN", error.shortMessage);
}
