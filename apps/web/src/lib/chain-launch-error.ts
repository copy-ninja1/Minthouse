import type { TxErrorCode } from "@minthouse/shared";

/**
 * A chain launch failed. `broadcast` is true only once the signed transaction
 * may have reached the network — in that case the deployment must not be cancelled.
 */
export class ChainLaunchError extends Error {
  override readonly name = "ChainLaunchError";

  constructor(
    readonly code: TxErrorCode,
    message: string,
    readonly broadcast: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}
