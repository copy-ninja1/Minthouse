import type { OperationStatus, TxErrorCode, VerificationResult } from "@minthouse/shared";
import { mayBeOnChain, transitionPath } from "@minthouse/shared";

/** What the chain says about a submitted deployment, independent of chain family. */
export type ChainOutcome =
  /** The transaction is known to the network but not yet confirmed and verified. */
  | { kind: "pending" }
  /** The network has no record of it, and it is not provably dead yet. */
  | { kind: "unknown" }
  /** The transaction provably did not create the token. */
  | { kind: "failed"; code: TxErrorCode; reason: string }
  /** The transaction landed, but the token on-chain differs from the request. */
  | { kind: "mismatch"; tokenAddress: string | null; reason: string; details: Record<string, string> }
  | { kind: "verified"; tokenAddress: string; totalSupply: string; details: Record<string, string> };

/** After this long without any trace of the transaction, a person has to look at it. */
export const RECOVERY_AFTER_MS = 30 * 60_000;

export type DeploymentDecision = {
  status: OperationStatus;
  errorCode: TxErrorCode | null;
  verification: VerificationResult | null;
  tokenAddress?: string;
  /** Base units, as verified on-chain. */
  totalSupply?: string;
};

/**
 * Maps a chain outcome onto the deployment lifecycle. Returns null when the
 * record should stay as it is. Only `verified` can lead to `completed`.
 */
export function decideDeployment(
  current: { status: OperationStatus; submittedAt: Date | null },
  outcome: ChainOutcome,
  now: Date,
): DeploymentDecision | null {
  if (!mayBeOnChain(current.status)) {
    return null;
  }
  const checkedAt = now.toISOString();
  let next: DeploymentDecision;
  switch (outcome.kind) {
    case "verified":
      next = {
        status: "completed",
        errorCode: null,
        tokenAddress: outcome.tokenAddress,
        totalSupply: outcome.totalSupply,
        verification: { verified: true, checkedAt, summary: "Verified against on-chain state.", details: outcome.details },
      };
      break;
    case "mismatch":
      next = {
        status: "failed",
        errorCode: "VERIFICATION_FAILED",
        ...(outcome.tokenAddress ? { tokenAddress: outcome.tokenAddress } : {}),
        verification: { verified: false, checkedAt, summary: outcome.reason, details: outcome.details },
      };
      break;
    case "failed":
      next = {
        status: "failed",
        errorCode: outcome.code,
        verification: { verified: false, checkedAt, summary: outcome.reason, details: {} },
      };
      break;
    case "pending":
      if (current.status !== "submitted") {
        return null;
      }
      next = { status: "confirming", errorCode: null, verification: null };
      break;
    case "unknown": {
      const age = current.submittedAt ? now.getTime() - current.submittedAt.getTime() : 0;
      if (current.status === "requires-recovery" || age < RECOVERY_AFTER_MS) {
        return null;
      }
      next = { status: "requires-recovery", errorCode: "CONFIRMATION_TIMEOUT", verification: null };
      break;
    }
    default: {
      const exhaustive: never = outcome;
      throw new Error(`Unhandled chain outcome ${String(exhaustive)}`);
    }
  }
  const path = transitionPath(current.status, next.status);
  return path === null || path.length === 0 ? null : next;
}
