import { Injectable } from "@nestjs/common";
import { type Hash, getAddress } from "viem";
import { type BscTokenConfig, type NetworkId, tokenConfigSchema } from "@minthouse/shared";
import { reconcileEvmTransaction, verifyBscDeployment } from "@minthouse/blockchain/bsc";
import { type SolanaDeploymentCheck, reconcileSolanaSignature, verifySplDeployment } from "@minthouse/blockchain/solana";
import { verifyPumpLaunch } from "@minthouse/blockchain/pump";
import type { Connection } from "@solana/web3.js";
import { ChainClientsService } from "../chains/chain-clients.service.js";
import type { ChainOutcome } from "./chain-outcome.js";

export type VerifiableDeployment = {
  network: string;
  creator: string;
  config: unknown;
  txId: string;
  tokenAddress: string | null;
  metadataUri: string | null;
  evmNonce: number | null;
  lastValidBlockHeight: bigint | null;
};

/** Asks the chain what a deployment transaction actually did. Read-only. */
@Injectable()
export class DeploymentVerifier {
  constructor(private readonly chains: ChainClientsService) {}

  async check(deployment: VerifiableDeployment): Promise<ChainOutcome> {
    const config = tokenConfigSchema.parse(deployment.config);
    const network: NetworkId = config.network;
    switch (config.mode) {
      case "bsc-erc20":
        return this.checkBsc(network, deployment, config);
      case "solana-spl":
      case "pumpfun": {
        if (!deployment.tokenAddress || !deployment.metadataUri) {
          return { kind: "failed", code: "VERIFICATION_FAILED", reason: "The deployment is missing its mint address or metadata URI." };
        }
        const connection = this.chains.solana(network);
        const params = {
          signature: deployment.txId,
          mint: deployment.tokenAddress,
          creator: deployment.creator,
          metadataUri: deployment.metadataUri,
        };
        const result =
          config.mode === "solana-spl"
            ? await verifySplDeployment(connection, { ...params, expected: config })
            : await verifyPumpLaunch(connection, { ...params, expected: config });
        return this.fromSolanaCheck(connection, deployment, result, config.mode === "pumpfun" ? "supplyBaseUnits" : "initialSupplyBaseUnits");
      }
      default: {
        const exhaustive: never = config;
        throw new Error(`Unhandled launch mode ${String(exhaustive)}`);
      }
    }
  }

  private async checkBsc(
    network: NetworkId,
    deployment: VerifiableDeployment,
    config: BscTokenConfig,
  ): Promise<ChainOutcome> {
    const client = this.chains.evm(network);
    const hash = deployment.txId as Hash;
    const result = await verifyBscDeployment(client, { txHash: hash, creator: deployment.creator, expected: config });
    switch (result.status) {
      case "verified":
        return {
          kind: "verified",
          tokenAddress: result.tokenAddress,
          totalSupply: result.details.initialSupplyBaseUnits ?? "0",
          details: result.details,
        };
      case "mismatch":
        return { kind: "mismatch", tokenAddress: result.tokenAddress, reason: result.reason, details: result.details };
      case "failed":
        return { kind: "failed", code: result.code, reason: result.reason };
      case "pending": {
        const tx = await reconcileEvmTransaction(client, {
          hash,
          from: getAddress(deployment.creator),
          ...(deployment.evmNonce === null ? {} : { nonce: deployment.evmNonce }),
        });
        switch (tx.state) {
          case "pending":
          case "success":
          case "reverted":
            return { kind: "pending" };
          case "replaced":
            return {
              kind: "failed",
              code: "DROPPED",
              reason: "Another transaction from the creator used the same nonce, so this deployment can never execute.",
            };
          case "unknown":
            return { kind: "unknown" };
          default: {
            const exhaustive: never = tx;
            throw new Error(`Unhandled EVM state ${String(exhaustive)}`);
          }
        }
      }
      default: {
        const exhaustive: never = result;
        throw new Error(`Unhandled BSC check ${String(exhaustive)}`);
      }
    }
  }

  private async fromSolanaCheck(
    connection: Connection,
    deployment: VerifiableDeployment,
    result: SolanaDeploymentCheck,
    supplyDetail: string,
  ): Promise<ChainOutcome> {
    switch (result.status) {
      case "verified":
        return { kind: "verified", tokenAddress: result.tokenAddress, totalSupply: result.details[supplyDetail] ?? "0", details: result.details };
      case "mismatch":
        return { kind: "mismatch", tokenAddress: result.tokenAddress, reason: result.reason, details: result.details };
      case "failed":
        return { kind: "failed", code: result.code, reason: result.reason };
      case "pending": {
        const tx = await reconcileSolanaSignature(connection, {
          signature: deployment.txId,
          ...(deployment.lastValidBlockHeight === null ? {} : { lastValidBlockHeight: Number(deployment.lastValidBlockHeight) }),
        });
        switch (tx.state) {
          case "processing":
          case "confirmed":
          case "finalized":
            return { kind: "pending" };
          case "failed":
            return { kind: "failed", code: "REVERTED", reason: `Transaction failed: ${tx.error}` };
          case "expired":
            return { kind: "failed", code: "EXPIRED", reason: "The transaction's blockhash expired before it landed. It can never execute." };
          case "unknown":
            return { kind: "unknown" };
          default: {
            const exhaustive: never = tx;
            throw new Error(`Unhandled Solana state ${String(exhaustive)}`);
          }
        }
      }
      default: {
        const exhaustive: never = result;
        throw new Error(`Unhandled Solana check ${String(exhaustive)}`);
      }
    }
  }
}
