import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PublicKey } from "@solana/web3.js";
import { BaseError } from "viem";
import {
  CHAIN_FAMILIES,
  LAUNCH_MODES,
  LAUNCH_MODE_CAPABILITIES,
  NETWORK_IDS,
  type NetworkId,
  TOKEN_SOURCES,
  type TokenLookup,
  type TokenPage,
  type TokenSearchQuery,
  type TokenSummary,
  getNetwork,
  isAddressForFamily,
  normalizeAddress,
  tokenSearchQuerySchema,
} from "@minthouse/shared";
import { NotAContractError, readErc20State } from "@minthouse/blockchain/bsc";
import { NotAMintError, readMintState } from "@minthouse/blockchain/solana";
import { NotAPumpCoinError, PUMP_PROGRAM_ID, type PumpCoinState, describePumpCurve, loadPumpCurve } from "@minthouse/blockchain/pump";
import { ChainClientsService } from "../chains/chain-clients.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { Prisma, Token } from "../generated/prisma/client.js";

function pick<T extends string>(values: readonly T[], value: string | null): T | null {
  return values.find((candidate) => candidate === value) ?? null;
}

function required<T extends string>(values: readonly T[], value: string, field: string): T {
  const parsed = pick(values, value);
  if (parsed === null) {
    throw new Error(`Corrupt token ${field}: ${value}`);
  }
  return parsed;
}

export function toTokenSummary(row: Token): TokenSummary {
  return {
    family: required(CHAIN_FAMILIES, row.family, "family"),
    network: required(NETWORK_IDS, row.network, "network"),
    address: row.address,
    name: row.name,
    symbol: row.symbol,
    decimals: row.decimals,
    totalSupply: row.totalSupply,
    mode: pick(LAUNCH_MODES, row.mode),
    imageUri: row.imageUri,
    metadataUri: row.metadataUri,
    source: required(TOKEN_SOURCES, row.source, "source"),
    onchainVerifiedAt: row.onchainVerifiedAt?.toISOString() ?? null,
    indexedAt: row.indexedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

type Cursor = { createdAt: Date; id: string };

function encodeCursor(row: Token): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString("base64url");
}

function decodeCursor(value: string): Cursor {
  const [timestamp, id] = Buffer.from(value, "base64url").toString("utf8").split("|");
  const createdAt = new Date(timestamp ?? "");
  if (!id || Number.isNaN(createdAt.getTime()) || !/^[0-9a-f-]{36}$/.test(id)) {
    throw new BadRequestException("Invalid cursor.");
  }
  return { createdAt, id };
}

@Injectable()
export class TokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chains: ChainClientsService,
  ) {}

  /** Lists tokens whose deployment the API verified on-chain, newest first. */
  async search(query: TokenSearchQuery): Promise<TokenPage> {
    const input = tokenSearchQuerySchema.parse(query);
    const cursor = input.cursor ? decodeCursor(input.cursor) : null;
    const where: Prisma.TokenWhereInput = {
      onchainVerifiedAt: { not: null },
      ...(input.family ? { family: input.family } : {}),
      ...(input.network ? { network: input.network } : {}),
      AND: [
        input.q
          ? {
              OR: [
                { name: { contains: input.q, mode: "insensitive" } },
                { symbol: { contains: input.q, mode: "insensitive" } },
                { address: { equals: input.q, mode: "insensitive" } },
              ],
            }
          : {},
        cursor
          ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] }
          : {},
      ],
    };
    const rows = await this.prisma.token.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
    });
    const page = rows.slice(0, input.limit);
    const last = page.at(-1);
    return {
      items: page.map(toTokenSummary),
      nextCursor: rows.length > input.limit && last ? encodeCursor(last) : null,
    };
  }

  /** Reads a token's current state directly from the chain. */
  async lookup(network: NetworkId, rawAddress: string): Promise<TokenLookup> {
    this.chains.assertEnabled(network);
    const { family } = getNetwork(network);
    if (!isAddressForFamily(family, rawAddress)) {
      throw new BadRequestException("Not a valid address for this network.");
    }
    const address = normalizeAddress(family, rawAddress);
    const indexed = await this.prisma.token.findUnique({ where: { network_address: { network, address } } });
    const platformDeploymentId = indexed?.deploymentId ?? null;
    const readAt = new Date().toISOString();

    switch (family) {
      case "bsc": {
        let state;
        try {
          state = await readErc20State(this.chains.evm(network), address);
        } catch (error) {
          if (error instanceof NotAContractError) {
            throw new NotFoundException(error.message);
          }
          if (error instanceof BaseError && error.name === "ContractFunctionExecutionError") {
            throw new NotFoundException("The contract at this address is not an ERC-20 token.");
          }
          throw error;
        }
        return {
          family,
          network,
          address: state.address,
          name: state.name,
          symbol: state.symbol,
          decimals: state.decimals,
          totalSupply: state.totalSupply.toString(),
          mode: state.isLaunchpadToken ? "bsc-erc20" : null,
          tokenStandard: state.isLaunchpadToken ? LAUNCH_MODE_CAPABILITIES["bsc-erc20"].tokenStandard : "ERC-20 (unverified source)",
          owner: state.owner,
          pendingOwner: state.pendingOwner,
          mintingEnabled: state.mintingEnabled,
          freezeAuthority: null,
          metadataUri: null,
          metadataMutable: null,
          pump: null,
          platformDeploymentId,
          readAt,
        };
      }
      case "solana": {
        const connection = this.chains.solana(network);
        let state;
        try {
          state = await readMintState(connection, address);
        } catch (error) {
          if (error instanceof NotAMintError) {
            throw new NotFoundException(error.message);
          }
          throw error;
        }
        const pump = await this.readPump(network, address);
        const mode = pump ? "pumpfun" : state.tokenProgram === "spl-token" ? "solana-spl" : null;
        return {
          family,
          network,
          address: state.address,
          name: state.metadata?.name ?? "",
          symbol: state.metadata?.symbol ?? "",
          decimals: state.decimals,
          totalSupply: state.supply.toString(),
          mode,
          tokenStandard: mode ? LAUNCH_MODE_CAPABILITIES[mode].tokenStandard : "Token-2022",
          owner: state.mintAuthority,
          pendingOwner: null,
          mintingEnabled: state.mintAuthority !== null,
          freezeAuthority: state.freezeAuthority,
          metadataUri: state.metadata?.uri ?? null,
          metadataMutable: state.metadata?.isMutable ?? null,
          pump: pump
            ? {
                phase: pump.phase,
                creator: pump.creator,
                bondingCurve: pump.bondingCurve,
                progressBps: pump.progressBps,
                realTokenReserves: pump.realTokenReserves.toString(),
                realQuoteReserves: pump.realQuoteReserves.toString(),
                marketCapLamports: pump.quoteMint === null ? (pump.marketCapQuote?.toString() ?? null) : null,
                pool: pump.pool,
              }
            : null,
          platformDeploymentId,
          readAt,
        };
      }
      default: {
        const exhaustive: never = family;
        throw new Error(`Unhandled family ${String(exhaustive)}`);
      }
    }
  }

  private async readPump(network: NetworkId, address: string): Promise<PumpCoinState | null> {
    if (!(LAUNCH_MODE_CAPABILITIES.pumpfun.networks as readonly string[]).includes(network)) {
      return null;
    }
    const connection = this.chains.solana(network);
    const programAccount = await connection.getAccountInfo(PUMP_PROGRAM_ID);
    if (!programAccount?.executable) {
      return null;
    }
    try {
      const context = await loadPumpCurve(connection, new PublicKey(address));
      return describePumpCurve(await this.chains.pumpProtocol(network), context);
    } catch (error) {
      if (error instanceof NotAPumpCoinError) {
        return null;
      }
      throw error;
    }
  }
}
