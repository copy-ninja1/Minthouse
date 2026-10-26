import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { getContractAddress } from "viem";
import {
  type CancelDeploymentRequest,
  type ChainFamily,
  type CreateDeploymentRequest,
  type Deployment,
  type DeploymentListQuery,
  OPERATION_STATUSES,
  type OperationStatus,
  PUMPFUN_TOKEN_DECIMALS,
  PUMPFUN_TOTAL_SUPPLY_WHOLE_TOKENS,
  type RecordSubmissionRequest,
  TX_ERROR_CODES,
  type TokenConfig,
  type TxErrorCode,
  canonicalJson,
  createDeploymentRequestSchema,
  deploymentListQuerySchema,
  getNetwork,
  isAddressForFamily,
  isEvmAddress,
  isSafeToRetry,
  mayBeOnChain,
  normalizeAddress,
  tokenConfigSchema,
  tokenMetadataDocumentSchema,
  transitionPath,
  verificationResultSchema,
} from "@minthouse/shared";
import { ChainClientsService } from "../chains/chain-clients.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { type Deployment as DeploymentRow, Prisma } from "../generated/prisma/client.js";
import { decideDeployment } from "./chain-outcome.js";
import { DeploymentVerifier } from "./deployment-verifier.js";

/** GET requests re-check the chain at most this often per deployment. */
const READ_THROUGH_INTERVAL_MS = 5_000;

const EVM_TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const SOLANA_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

function parseStatus(value: string): OperationStatus {
  const status = OPERATION_STATUSES.find((candidate) => candidate === value);
  if (!status) {
    throw new Error(`Corrupt deployment status: ${value}`);
  }
  return status;
}

function parseErrorCode(value: string | null): TxErrorCode | null {
  return TX_ERROR_CODES.find((candidate) => candidate === value) ?? null;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export function toDeployment(row: DeploymentRow): Deployment {
  const config = tokenConfigSchema.parse(row.config);
  const verification = verificationResultSchema.nullable().safeParse(row.verification ?? null);
  return {
    id: row.id,
    idempotencyKey: row.idempotencyKey,
    mode: config.mode,
    family: getNetwork(config.network).family,
    network: config.network,
    creator: row.creator,
    tokenAddress: row.tokenAddress,
    name: row.name,
    symbol: row.symbol,
    decimals: row.decimals,
    initialSupply: row.initialSupply,
    recipient: row.recipient,
    metadataUri: row.metadataUri,
    imageUri: row.imageUri,
    txId: row.txId,
    status: parseStatus(row.status),
    errorCode: parseErrorCode(row.errorCode),
    verification: verification.success ? verification.data : null,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function supplyFields(config: TokenConfig): { decimals: number; initialSupply: string; recipient: string | null } {
  switch (config.mode) {
    case "bsc-erc20":
    case "solana-spl":
      return { decimals: config.decimals, initialSupply: config.initialSupply, recipient: config.recipient };
    case "pumpfun":
      return { decimals: PUMPFUN_TOKEN_DECIMALS, initialSupply: PUMPFUN_TOTAL_SUPPLY_WHOLE_TOKENS.toString(), recipient: null };
    default: {
      const exhaustive: never = config;
      throw new Error(`Unhandled launch mode ${String(exhaustive)}`);
    }
  }
}

@Injectable()
export class DeploymentsService {
  private readonly logger = new Logger(DeploymentsService.name);
  private readonly inFlight = new Map<string, Promise<DeploymentRow>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly chains: ChainClientsService,
    private readonly verifier: DeploymentVerifier,
  ) {}

  private async findRow(id: string): Promise<DeploymentRow> {
    const row = await this.prisma.deployment.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException("Deployment not found.");
    }
    return row;
  }

  /**
   * Records the intent to deploy. Idempotent: repeating the same request
   * returns the existing record; reusing the key for a different request is
   * refused.
   */
  async create(request: CreateDeploymentRequest): Promise<{ deployment: Deployment; created: boolean }> {
    const input = createDeploymentRequestSchema.parse(request);
    const { config } = input;
    this.chains.assertEnabled(config.network);
    const network = getNetwork(config.network);
    if (!isAddressForFamily(network.family, input.creator)) {
      throw new BadRequestException(`creator is not a valid ${network.label} address.`);
    }
    const creator = normalizeAddress(network.family, input.creator);

    let metadataUri: string | null = null;
    let imageUri: string | null = null;
    if (input.metadataId) {
      const asset = await this.prisma.metadataAsset.findUnique({ where: { id: input.metadataId } });
      if (!asset || asset.kind !== "document") {
        throw new NotFoundException("Metadata document not found.");
      }
      const document = tokenMetadataDocumentSchema.parse(asset.document);
      if (document.name !== config.name || document.symbol !== config.symbol) {
        throw new UnprocessableEntityException("The published metadata has a different name or symbol than this token.");
      }
      if (network.isMainnet && !asset.persistent) {
        throw new UnprocessableEntityException("Mainnet tokens need metadata pinned to IPFS, not temporary storage.");
      }
      metadataUri = asset.uri;
      imageUri = document.image;
    } else if (network.family === "solana") {
      throw new UnprocessableEntityException("Solana launches need published metadata, because its URI is written on-chain.");
    }

    const existing = await this.prisma.deployment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      return { deployment: this.assertSameRequest(existing, creator, config, input.metadataId), created: false };
    }

    try {
      const row = await this.prisma.deployment.create({
        data: {
          idempotencyKey: input.idempotencyKey,
          mode: config.mode,
          family: network.family,
          network: config.network,
          creator,
          name: config.name,
          symbol: config.symbol,
          ...supplyFields(config),
          config,
          metadataId: input.metadataId,
          metadataUri,
          imageUri,
          status: "awaiting-approval",
        },
      });
      return { deployment: toDeployment(row), created: true };
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const raced = await this.prisma.deployment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (!raced) {
        throw error;
      }
      return { deployment: this.assertSameRequest(raced, creator, config, input.metadataId), created: false };
    }
  }

  private assertSameRequest(row: DeploymentRow, creator: string, config: TokenConfig, metadataId: string | null): Deployment {
    if (row.creator !== creator || row.metadataId !== metadataId || canonicalJson(row.config) !== canonicalJson(config)) {
      throw new ConflictException("This idempotency key was already used for a different deployment request.");
    }
    return toDeployment(row);
  }

  /** Records the wallet-signed transaction. The token is not considered deployed until verified. */
  async recordSubmission(id: string, body: RecordSubmissionRequest): Promise<Deployment> {
    const row = await this.findRow(id);
    if (row.txId === body.txId) {
      return toDeployment(row);
    }
    const status = parseStatus(row.status);
    if (mayBeOnChain(status) || status === "completed") {
      throw new ConflictException(
        `A transaction (${row.txId ?? "unknown"}) is already recorded for this deployment. Check its outcome before submitting another.`,
      );
    }
    const errorCode = parseErrorCode(row.errorCode);
    if (status === "failed" && !(errorCode && isSafeToRetry(errorCode))) {
      throw new ConflictException("This deployment failed in a way that needs review before another attempt.");
    }

    const family = row.family as ChainFamily;
    if (family === "bsc" ? !EVM_TX_HASH.test(body.txId) : !SOLANA_SIGNATURE.test(body.txId)) {
      throw new BadRequestException("txId is not a valid transaction id for this chain.");
    }
    if (!isAddressForFamily(family, body.tokenAddress)) {
      throw new BadRequestException("tokenAddress is not a valid address for this chain.");
    }
    if (family === "bsc" && body.evmNonce !== undefined && isEvmAddress(row.creator)) {
      const predicted = getContractAddress({ from: row.creator as `0x${string}`, nonce: BigInt(body.evmNonce) });
      if (normalizeAddress("bsc", body.tokenAddress) !== predicted) {
        throw new UnprocessableEntityException("tokenAddress does not match the contract address for this creator and nonce.");
      }
    }
    if (transitionPath(status, "submitted") === null) {
      throw new ConflictException(`A deployment in status ${status} cannot accept a submission.`);
    }

    try {
      const updated = await this.prisma.deployment.update({
        where: { id, updatedAt: row.updatedAt },
        data: {
          status: "submitted",
          txId: body.txId,
          tokenAddress: normalizeAddress(family, body.tokenAddress),
          evmNonce: body.evmNonce ?? null,
          lastValidBlockHeight: body.lastValidBlockHeight === undefined ? null : BigInt(body.lastValidBlockHeight),
          submittedAt: new Date(),
          errorCode: null,
          verification: Prisma.DbNull,
          checkAttempts: 0,
          lastCheckedAt: null,
        },
      });
      return toDeployment(updated);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException("This transaction is already recorded for another deployment.");
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        throw new ConflictException("The deployment changed while recording the submission. Reload it and try again.");
      }
      throw error;
    }
  }

  async cancel(id: string, body: CancelDeploymentRequest): Promise<Deployment> {
    const row = await this.findRow(id);
    const status = parseStatus(row.status);
    if (status === "cancelled") {
      return toDeployment(row);
    }
    if (status !== "awaiting-approval") {
      throw new ConflictException(`A deployment in status ${status} cannot be cancelled.`);
    }
    const updated = await this.prisma.deployment.update({
      where: { id },
      data: { status: "cancelled", errorCode: body.errorCode ?? null },
    });
    return toDeployment(updated);
  }

  /** Returns the deployment, re-checking the chain first when its outcome is still open. */
  async get(id: string): Promise<Deployment> {
    let row = await this.findRow(id);
    const stale = !row.lastCheckedAt || Date.now() - row.lastCheckedAt.getTime() > READ_THROUGH_INTERVAL_MS;
    if (mayBeOnChain(parseStatus(row.status)) && stale) {
      row = await this.refresh(row);
    }
    return toDeployment(row);
  }

  async list(query: DeploymentListQuery): Promise<Deployment[]> {
    const input = deploymentListQuerySchema.parse(query);
    const creator = isEvmAddress(input.creator) ? normalizeAddress("bsc", input.creator) : input.creator;
    const rows = await this.prisma.deployment.findMany({
      where: { creator, ...(input.network ? { network: input.network } : {}) },
      orderBy: { createdAt: "desc" },
      take: input.limit,
    });
    return rows.map(toDeployment);
  }

  /** Re-checks one deployment against the chain. Concurrent calls for the same id share one check. */
  refresh(row: DeploymentRow): Promise<DeploymentRow> {
    const existing = this.inFlight.get(row.id);
    if (existing) {
      return existing;
    }
    const pending = this.check(row).finally(() => this.inFlight.delete(row.id));
    this.inFlight.set(row.id, pending);
    return pending;
  }

  private async check(row: DeploymentRow): Promise<DeploymentRow> {
    if (!row.txId) {
      return row;
    }
    const now = new Date();
    let decision;
    try {
      const outcome = await this.verifier.check({ ...row, txId: row.txId });
      decision = decideDeployment({ status: parseStatus(row.status), submittedAt: row.submittedAt }, outcome, now);
    } catch (error) {
      this.logger.warn({ err: error, deploymentId: row.id }, "Chain check failed; will retry");
      return this.prisma.deployment.update({
        where: { id: row.id },
        data: { lastCheckedAt: now, checkAttempts: { increment: 1 } },
      });
    }

    if (!decision) {
      return this.prisma.deployment.update({
        where: { id: row.id },
        data: { lastCheckedAt: now, checkAttempts: { increment: 1 } },
      });
    }

    const family = row.family as ChainFamily;
    const tokenAddress = decision.tokenAddress ? normalizeAddress(family, decision.tokenAddress) : row.tokenAddress;
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.deployment.update({
        where: { id: row.id },
        data: {
          status: decision.status,
          errorCode: decision.errorCode,
          verification: decision.verification ?? Prisma.DbNull,
          tokenAddress,
          lastCheckedAt: now,
          checkAttempts: { increment: 1 },
        },
      });
      if (decision.status === "completed" && tokenAddress) {
        const totalSupply = decision.totalSupply ?? null;
        await tx.token.upsert({
          where: { network_address: { network: row.network, address: tokenAddress } },
          update: { onchainVerifiedAt: now, deploymentId: row.id, source: "platform-deployment" },
          create: {
            family,
            network: row.network,
            address: tokenAddress,
            name: row.name,
            symbol: row.symbol,
            decimals: row.decimals,
            totalSupply,
            mode: row.mode,
            imageUri: row.imageUri,
            metadataUri: row.metadataUri,
            source: "platform-deployment",
            deploymentId: row.id,
            onchainVerifiedAt: now,
          },
        });
      }
      return updated;
    });
  }
}
