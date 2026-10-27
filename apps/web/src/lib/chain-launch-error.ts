import type { TxErrorCode } from "@minthouse/shared";

/** Partial result when the mint/deploy already broadcast before a later step failed. */
export type PartialLaunchSubmission = {
  txId: string;
  tokenAddress: string;
  evmNonce?: number;
  lastValidBlockHeight?: number;
};

/**
 * A chain launch failed. `broadcast` is true only once the signed transaction
 * may have reached the network — in that case the deployment must not be cancelled.
 * When the mint/deploy already landed but a later step (e.g. liquidity) failed,
 * attach `submission` so the API can still record and verify the token.
 */
export class ChainLaunchError extends Error {
  override readonly name = "ChainLaunchError";

  readonly submission?: PartialLaunchSubmission;

  constructor(
    readonly code: TxErrorCode,
    message: string,
    readonly broadcast: boolean,
    options?: { cause?: unknown; submission?: PartialLaunchSubmission },
  ) {
    super(message, options);
    this.submission = options?.submission;
  }
}
