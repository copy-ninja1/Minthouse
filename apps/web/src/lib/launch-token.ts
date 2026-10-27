import {
  type CancelDeploymentRequest,
  type CreateDeploymentRequest,
  type Deployment,
  type PublishMetadataRequest,
  type PublishedMetadata,
  type RecordSubmissionRequest,
  type TokenConfig,
  TX_ERROR_MESSAGES,
  deriveIdempotencyKey,
  getNetwork,
  isSafeToRetry,
  isTerminalStatus,
  mayBeOnChain,
  normalizeAddress,
  type LogoAsset,
} from "@minthouse/shared";
import { ChainLaunchError } from "./chain-launch-error";

export const LAUNCH_STEPS = ["publish", "sign", "verify"] as const;
export type LaunchStep = (typeof LAUNCH_STEPS)[number];

const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_VERIFY_TIMEOUT_MS = 120_000;

export class LaunchFlowError extends Error {
  override readonly name = "LaunchFlowError";

  constructor(
    message: string,
    readonly deployment: Deployment | null,
  ) {
    super(message);
  }
}

export type LaunchSubmission = {
  txId: string;
  tokenAddress: string;
  evmNonce?: number;
  lastValidBlockHeight?: number;
};

/** The connected wallet. Signing stays behind this function so the flow can be tested without a chain. */
export type TokenDeployer = {
  family: "bsc" | "solana";
  address: string;
  submit: (
    config: TokenConfig,
    metadataUri: string,
  ) => Promise<LaunchSubmission>;
};

export type LaunchApi = {
  uploadLogo: (file: File) => Promise<LogoAsset>;
  publishMetadata: (body: PublishMetadataRequest) => Promise<PublishedMetadata>;
  createDeployment: (body: CreateDeploymentRequest) => Promise<Deployment>;
  recordSubmission: (
    id: string,
    body: RecordSubmissionRequest,
  ) => Promise<Deployment>;
  cancelDeployment: (
    id: string,
    body: CancelDeploymentRequest,
  ) => Promise<Deployment>;
  getDeployment: (id: string) => Promise<Deployment>;
};

export type LaunchTiming = {
  pollIntervalMs?: number;
  verifyTimeoutMs?: number;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function cancelQuietly(
  api: LaunchApi,
  id: string,
  errorCode: CancelDeploymentRequest["errorCode"],
): Promise<void> {
  try {
    await api.cancelDeployment(id, errorCode ? { errorCode } : {});
  } catch {
    // The signing error is the one the user can act on.
  }
}

async function settle(
  api: LaunchApi,
  id: string,
  timing: Required<LaunchTiming>,
): Promise<Deployment> {
  const started = Date.now();
  let deployment = await api.getDeployment(id);
  while (
    !isTerminalStatus(deployment.status) &&
    Date.now() - started < timing.verifyTimeoutMs
  ) {
    await delay(timing.pollIntervalMs);
    deployment = await api.getDeployment(id);
  }
  if (deployment.status === "completed") {
    return deployment;
  }
  const code =
    deployment.errorCode ??
    (isTerminalStatus(deployment.status) ? "UNKNOWN" : "CONFIRMATION_TIMEOUT");
  throw new LaunchFlowError(TX_ERROR_MESSAGES[code], deployment);
}

/**
 * Publishes metadata, records the intent, asks the wallet to sign, then waits
 * until the API has checked the result on chain.
 */
export async function launchToken(
  input: { config: TokenConfig; logo: File; deployer: TokenDeployer },
  api: LaunchApi,
  onStep: (step: LaunchStep) => void,
  timing: LaunchTiming = {},
): Promise<Deployment> {
  const schedule: Required<LaunchTiming> = {
    pollIntervalMs: timing.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    verifyTimeoutMs: timing.verifyTimeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS,
  };
  const family = getNetwork(input.config.network).family;
  if (input.deployer.family !== family) {
    throw new LaunchFlowError(
      "The connected wallet is for a different chain than this token.",
      null,
    );
  }
  const creator = normalizeAddress(family, input.deployer.address);

  onStep("publish");
  const logo = await api.uploadLogo(input.logo);
  const metadata = await api.publishMetadata({
    mode: input.config.mode,
    network: input.config.network,
    logoAssetId: logo.id,
    name: input.config.name,
    symbol: input.config.symbol,
    description: input.config.description,
    website: input.config.website,
    twitter: input.config.twitter,
    telegram: input.config.telegram,
  });

  onStep("sign");
  const idempotencyKey = await deriveIdempotencyKey({
    creator,
    metadataId: metadata.id,
    config: input.config,
  });
  let deployment = await api.createDeployment({
    idempotencyKey,
    creator,
    config: input.config,
    metadataId: metadata.id,
  });

  if (deployment.status === "completed") {
    return deployment;
  }
  if (mayBeOnChain(deployment.status)) {
    onStep("verify");
    return settle(api, deployment.id, schedule);
  }
  if (
    deployment.status === "failed" &&
    !(deployment.errorCode && isSafeToRetry(deployment.errorCode))
  ) {
    throw new LaunchFlowError(
      TX_ERROR_MESSAGES[deployment.errorCode ?? "UNKNOWN"],
      deployment,
    );
  }

  let submitted: LaunchSubmission;
  let postMintError: ChainLaunchError | null = null;
  try {
    submitted = await input.deployer.submit(input.config, metadata.metadataUri);
  } catch (error) {
    if (
      error instanceof ChainLaunchError &&
      error.submission &&
      error.broadcast
    ) {
      // Mint/deploy landed; a later step (liquidity) failed. Record the token
      // so verification can finish, then surface the post-mint error.
      submitted = error.submission;
      postMintError = error;
    } else {
      if (error instanceof ChainLaunchError && !error.broadcast) {
        await cancelQuietly(api, deployment.id, error.code);
      }
      const message =
        error instanceof Error ? error.message : TX_ERROR_MESSAGES.UNKNOWN;
      throw new LaunchFlowError(message, deployment);
    }
  }

  deployment = await api.recordSubmission(deployment.id, {
    txId: submitted.txId,
    tokenAddress: submitted.tokenAddress,
    ...(submitted.evmNonce === undefined
      ? {}
      : { evmNonce: submitted.evmNonce }),
    ...(submitted.lastValidBlockHeight === undefined
      ? {}
      : { lastValidBlockHeight: submitted.lastValidBlockHeight }),
  });

  onStep("verify");
  const verified = await settle(api, deployment.id, schedule);
  if (postMintError) {
    throw new LaunchFlowError(postMintError.message, verified);
  }
  return verified;
}
