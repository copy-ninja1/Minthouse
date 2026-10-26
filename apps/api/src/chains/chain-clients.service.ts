import { Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { Connection } from "@solana/web3.js";
import { http, type PublicClient, createPublicClient } from "viem";
import type { ApiEnv } from "@minthouse/config";
import { type NetworkId, getEvmNetwork, getSolanaNetwork } from "@minthouse/shared";
import { type PumpProtocol, fetchPumpProtocol } from "@minthouse/blockchain/pump";
import { API_ENV } from "../config/env.js";

const RPC_ENV: Record<NetworkId, keyof ApiEnv> = {
  "bsc-mainnet": "BSC_MAINNET_RPC_URL",
  "bsc-testnet": "BSC_TESTNET_RPC_URL",
  "bsc-local": "BSC_LOCAL_RPC_URL",
  "solana-mainnet": "SOLANA_MAINNET_RPC_URL",
  "solana-devnet": "SOLANA_DEVNET_RPC_URL",
  "solana-local": "SOLANA_LOCAL_RPC_URL",
};

const PUMP_PROTOCOL_TTL_MS = 60_000;

/**
 * Read-only chain access for the API. RPC URLs (which may embed provider
 * credentials) stay on the server; the API never holds signing keys.
 */
@Injectable()
export class ChainClientsService {
  private readonly evmClients = new Map<NetworkId, PublicClient>();
  private readonly solanaConnections = new Map<NetworkId, Connection>();
  private readonly pumpProtocols = new Map<NetworkId, { value: Promise<PumpProtocol>; expiresAt: number }>();

  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  isEnabled(network: NetworkId): boolean {
    return this.env.ENABLED_NETWORKS.includes(network);
  }

  assertEnabled(network: NetworkId): void {
    if (!this.isEnabled(network)) {
      throw new ServiceUnavailableException(`${network} is not enabled on this server.`);
    }
  }

  private rpcUrl(network: NetworkId, fallback: string): string {
    const configured = this.env[RPC_ENV[network]];
    return typeof configured === "string" ? configured : fallback;
  }

  evm(network: NetworkId): PublicClient {
    this.assertEnabled(network);
    let client = this.evmClients.get(network);
    if (!client) {
      const definition = getEvmNetwork(network);
      client = createPublicClient({
        transport: http(this.rpcUrl(network, definition.defaultRpcUrl), { timeout: 15_000, retryCount: 2 }),
      });
      this.evmClients.set(network, client);
    }
    return client;
  }

  solana(network: NetworkId): Connection {
    this.assertEnabled(network);
    let connection = this.solanaConnections.get(network);
    if (!connection) {
      const definition = getSolanaNetwork(network);
      connection = new Connection(this.rpcUrl(network, definition.defaultRpcUrl), { commitment: "confirmed" });
      this.solanaConnections.set(network, connection);
    }
    return connection;
  }

  /** Pump Global and fee config, re-read from chain at most once a minute. */
  pumpProtocol(network: NetworkId): Promise<PumpProtocol> {
    const cached = this.pumpProtocols.get(network);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    const value = fetchPumpProtocol(this.solana(network));
    this.pumpProtocols.set(network, { value, expiresAt: Date.now() + PUMP_PROTOCOL_TTL_MS });
    value.catch(() => this.pumpProtocols.delete(network));
    return value;
  }
}
