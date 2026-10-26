import { BadRequestException, ConflictException, Injectable, Logger } from "@nestjs/common";
import { type Hash, getAddress } from "viem";
import {
  type ChainFamily,
  type NetworkId,
  OPERATION_STATUSES,
  OPERATION_TYPES,
  type OperationHistoryItem,
  type OperationHistoryQuery,
  TX_ERROR_CODES,
  type UpsertOperationRequest,
  getNetwork,
  isAddressForFamily,
  isEvmAddress,
  isNetworkId,
  normalizeAddress,
  operationHistoryQuerySchema,
  transitionPath,
} from "@minthouse/shared";
import { reconcileEvmTransaction } from "@minthouse/blockchain/bsc";
import { reconcileSolanaSignature } from "@minthouse/blockchain/solana";
import { ChainClientsService } from "../chains/chain-clients.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { Operation } from "../generated/prisma/client.js";

export type ChainStatus = OperationHistoryItem["chainStatus"];
const CHAIN_STATUSES = ["unknown", "pending", "success", "failed", "not-found"] as const satisfies readonly ChainStatus[];

function pick<T extends string>(values: readonly T[], value: string, fallback: T): T {
  return values.find((candidate) => candidate === value) ?? fallback;
}

function parseNetwork(value: string): NetworkId {
  if (!isNetworkId(value)) {
    throw new Error(`Corrupt operation network: ${value}`);
  }
  return value;
}

export function toHistoryItem(row: Operation): OperationHistoryItem {
  const network = getNetwork(parseNetwork(row.network));
  return {
    id: row.id,
    idempotencyKey: row.idempotencyKey,
    type: pick(OPERATION_TYPES, row.type, "transfer"),
    family: network.family,
    network: network.id,
    wallet: row.wallet,
    target: row.target,
    txId: row.txId,
    status: pick(OPERATION_STATUSES, row.status, "requires-recovery"),
    errorCode: row.errorCode ? pick(TX_ERROR_CODES, row.errorCode, "UNKNOWN") : null,
    summary: row.summary,
    chainStatus: pick(CHAIN_STATUSES, row.chainStatus, "unknown"),
    chainCheckedAt: row.chainCheckedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Stores the public history of management operations (mint, transfer, burn, …)
 * reported by the client, alongside the server's own independent reading of
 * each transaction's on-chain status.
 */
@Injectable()
export class OperationsService {
  private readonly logger = new Logger(OperationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chains: ChainClientsService,
  ) {}

  async upsert(body: UpsertOperationRequest): Promise<{ item: OperationHistoryItem; created: boolean }> {
    this.chains.assertEnabled(body.network);
    const family = getNetwork(body.network).family;
    if (!isAddressForFamily(family, body.wallet)) {
      throw new BadRequestException("wallet is not a valid address for this network.");
    }
    if (body.target !== "" && !isAddressForFamily(family, body.target)) {
      throw new BadRequestException("target is not a valid address for this network.");
    }
    const wallet = normalizeAddress(family, body.wallet);
    const target = body.target === "" ? "" : normalizeAddress(family, body.target);

    const existing = await this.prisma.operation.findUnique({ where: { idempotencyKey: body.idempotencyKey } });
    if (!existing) {
      const created = await this.prisma.operation.create({
        data: {
          idempotencyKey: body.idempotencyKey,
          type: body.type,
          family,
          network: body.network,
          wallet,
          target,
          txId: body.txId,
          status: body.status,
          errorCode: body.errorCode,
          summary: body.summary,
        },
      });
      return { item: toHistoryItem(await this.refreshChainStatus(created)), created: true };
    }

    if (existing.wallet !== wallet || existing.type !== body.type || existing.network !== body.network) {
      throw new ConflictException("This idempotency key belongs to a different operation.");
    }
    if (existing.txId && body.txId && existing.txId !== body.txId) {
      throw new ConflictException("A different transaction is already recorded for this operation.");
    }
    const from = pick(OPERATION_STATUSES, existing.status, "requires-recovery");
    if (transitionPath(from, body.status) === null) {
      throw new ConflictException(`Operation status cannot change from ${from} to ${body.status}.`);
    }
    const updated = await this.prisma.operation.update({
      where: { id: existing.id },
      data: {
        target,
        txId: existing.txId ?? body.txId,
        status: body.status,
        errorCode: body.errorCode,
        summary: body.summary,
      },
    });
    return { item: toHistoryItem(await this.refreshChainStatus(updated)), created: false };
  }

  async history(query: OperationHistoryQuery): Promise<OperationHistoryItem[]> {
    const input = operationHistoryQuerySchema.parse(query);
    const wallet = isEvmAddress(input.wallet) ? normalizeAddress("bsc", input.wallet) : input.wallet;
    const rows = await this.prisma.operation.findMany({
      where: { wallet, ...(input.network ? { network: input.network } : {}) },
      orderBy: { createdAt: "desc" },
      take: input.limit,
    });
    return rows.map(toHistoryItem);
  }

  /** Reads the transaction's status from the chain. Never trusts the client's reported status. */
  async refreshChainStatus(row: Operation): Promise<Operation> {
    if (!row.txId || row.chainStatus === "success" || row.chainStatus === "failed") {
      return row;
    }
    let chainStatus: ChainStatus;
    try {
      chainStatus = await this.readChainStatus(row.family as ChainFamily, row);
    } catch (error) {
      this.logger.warn({ err: error, operationId: row.id }, "Operation status check failed");
      return row;
    }
    return this.prisma.operation.update({
      where: { id: row.id },
      data: { chainStatus, chainCheckedAt: new Date() },
    });
  }

  private async readChainStatus(family: ChainFamily, row: Operation): Promise<ChainStatus> {
    const network = parseNetwork(row.network);
    if (!row.txId) {
      return "unknown";
    }
    switch (family) {
      case "bsc": {
        const state = await reconcileEvmTransaction(this.chains.evm(network), { hash: row.txId as Hash, from: getAddress(row.wallet) });
        switch (state.state) {
          case "success":
            return "success";
          case "reverted":
            return "failed";
          case "pending":
            return "pending";
          case "replaced":
            return "not-found";
          case "unknown":
            return "unknown";
          default: {
            const exhaustive: never = state;
            throw new Error(`Unhandled EVM state ${String(exhaustive)}`);
          }
        }
      }
      case "solana": {
        const state = await reconcileSolanaSignature(this.chains.solana(network), { signature: row.txId });
        switch (state.state) {
          case "confirmed":
          case "finalized":
            return "success";
          case "failed":
            return "failed";
          case "processing":
            return "pending";
          case "expired":
            return "not-found";
          case "unknown":
            return "unknown";
          default: {
            const exhaustive: never = state;
            throw new Error(`Unhandled Solana state ${String(exhaustive)}`);
          }
        }
      }
      default: {
        const exhaustive: never = family;
        throw new Error(`Unhandled family ${String(exhaustive)}`);
      }
    }
  }
}
