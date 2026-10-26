import type { ChainFamily, NetworkId } from "./networks.js";
import type { TxErrorCode } from "./errors.js";

export const OPERATION_STATUSES = [
  "draft",
  "validating",
  "preparing-metadata",
  "awaiting-approval",
  "submitted",
  "confirming",
  "verifying",
  "completed",
  "failed",
  "cancelled",
  "requires-recovery",
] as const;
export type OperationStatus = (typeof OPERATION_STATUSES)[number];

/**
 * Allowed lifecycle transitions. Anything not listed is a bug.
 *
 * Key rule: once a transaction may have reached the network (`submitted` and
 * later), the only ways out are verified completion, verified failure, or
 * `requires-recovery`. It can never go back to `awaiting-approval` without
 * reconciliation proving the original transaction did not land.
 */
const TRANSITIONS: Record<OperationStatus, readonly OperationStatus[]> = {
  draft: ["validating", "cancelled"],
  validating: ["preparing-metadata", "awaiting-approval", "failed", "cancelled"],
  "preparing-metadata": ["awaiting-approval", "failed", "cancelled"],
  "awaiting-approval": ["submitted", "cancelled", "failed", "requires-recovery"],
  submitted: ["confirming", "failed", "requires-recovery"],
  confirming: ["verifying", "failed", "requires-recovery"],
  verifying: ["completed", "failed", "requires-recovery"],
  "requires-recovery": ["confirming", "verifying", "completed", "failed"],
  completed: [],
  failed: ["validating"],
  cancelled: ["validating"],
};

export function canTransition(from: OperationStatus, to: OperationStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  override readonly name = "InvalidTransitionError";
  constructor(
    readonly from: OperationStatus,
    readonly to: OperationStatus,
  ) {
    super(`Invalid operation transition: ${from} → ${to}`);
  }
}

export function assertTransition(from: OperationStatus, to: OperationStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

/** Statuses that can only be the end of a path, never a step on the way to another status. */
const ENDPOINT_ONLY: ReadonlySet<OperationStatus> = new Set(["requires-recovery", "failed", "cancelled", "completed"]);

/**
 * Shortest chain of legal transitions from `from` to `to` (excluding `from`),
 * e.g. submitted → completed gives [confirming, verifying, completed].
 * Recovery, failure and cancellation are never used as intermediate steps.
 * Returns null when `to` is unreachable and [] when they are equal.
 */
export function transitionPath(from: OperationStatus, to: OperationStatus): OperationStatus[] | null {
  if (from === to) {
    return [];
  }
  const previous = new Map<OperationStatus, OperationStatus>();
  const queue: OperationStatus[] = [from];
  while (queue.length > 0) {
    const current = queue.shift() as OperationStatus;
    for (const next of TRANSITIONS[current]) {
      if (next === from || previous.has(next) || (next !== to && ENDPOINT_ONLY.has(next))) {
        continue;
      }
      previous.set(next, current);
      if (next === to) {
        const path: OperationStatus[] = [to];
        let step = current;
        while (step !== from) {
          path.unshift(step);
          step = previous.get(step) as OperationStatus;
        }
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

export function isTerminalStatus(status: OperationStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

/**
 * Statuses in which a transaction may exist on-chain with an unknown outcome.
 * A new submission for the same idempotency key must be blocked while in these.
 */
export function mayBeOnChain(status: OperationStatus): boolean {
  return status === "submitted" || status === "confirming" || status === "verifying" || status === "requires-recovery";
}

export const OPERATION_TYPES = [
  "deploy-token",
  "pump-create",
  "pump-buy",
  "pump-sell",
  "mint",
  "transfer",
  "burn",
  "disable-minting",
  "transfer-ownership",
  "accept-ownership",
  "renounce-ownership",
  "set-mint-authority",
  "revoke-mint-authority",
  "revoke-approval",
] as const;
export type OperationType = (typeof OPERATION_TYPES)[number];

/** Operations that permanently remove a capability and need an explicit second confirmation. */
export const IRREVERSIBLE_OPERATIONS: ReadonlySet<OperationType> = new Set([
  "disable-minting",
  "renounce-ownership",
  "revoke-mint-authority",
]);

export type OperationError = {
  code: TxErrorCode;
  message: string;
};

export type EvmSubmissionContext = {
  family: "bsc";
  /** Account nonce observed immediately before the signing request. */
  nonce?: number;
};

export type SolanaSubmissionContext = {
  family: "solana";
  blockhash?: string;
  /** After this block height the transaction can no longer land. */
  lastValidBlockHeight?: number;
};

export type OperationVerification = {
  verified: boolean;
  checkedAt: string;
  summary: string;
  details: Record<string, string>;
};

/**
 * A non-sensitive record of one blockchain operation. Contains public data only;
 * signing material never enters this structure.
 */
export type OperationRecord = {
  id: string;
  idempotencyKey: string;
  type: OperationType;
  family: ChainFamily;
  network: NetworkId;
  wallet: string;
  /** Contract, mint or program the operation targets (empty for deployments until known). */
  target: string;
  txId: string | null;
  status: OperationStatus;
  error: OperationError | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  confirmedAt: string | null;
  context: EvmSubmissionContext | SolanaSubmissionContext;
  verification: OperationVerification | null;
  /** Free-form, public description shown in history ("Mint 1,000 MTK to 0x…"). */
  summary: string;
};
