import BN from "bn.js";
import type { Connection } from "@solana/web3.js";
import {
  type FeeConfig,
  GLOBAL_PDA,
  type Global,
  PUMP_FEE_CONFIG_PDA,
  PUMP_FEE_PROGRAM_ID,
  PUMP_PROGRAM_ID,
  PUMP_SDK,
} from "@pump-fun/pump-sdk";
import { PUMPFUN_TOKEN_DECIMALS, PUMPFUN_TOTAL_SUPPLY_WHOLE_TOKENS } from "@minthouse/shared";

export class PumpUnavailableError extends Error {
  override readonly name = "PumpUnavailableError";
}

export type PumpProtocol = {
  global: Global;
  feeConfig: FeeConfig;
  /** Base units every new coin is created with. */
  tokenTotalSupply: bigint;
  /** Base units sold through the curve before it completes. */
  initialRealTokenReserves: bigint;
  createV2Enabled: boolean;
};

export const PUMP_EXPECTED_TOTAL_SUPPLY = PUMPFUN_TOTAL_SUPPLY_WHOLE_TOKENS * 10n ** BigInt(PUMPFUN_TOKEN_DECIMALS);

export function toBn(value: bigint): BN {
  return new BN(value.toString());
}

export function fromBn(value: BN): bigint {
  return BigInt(value.toString());
}

/**
 * Loads the live Pump program configuration. Fails closed when the program,
 * its Global account or the fee configuration are missing on this cluster, or
 * when the protocol's fixed supply no longer matches what this app displays.
 */
export async function fetchPumpProtocol(connection: Connection): Promise<PumpProtocol> {
  const [program, globalAccount, feeConfigAccount] = await connection.getMultipleAccountsInfo(
    [PUMP_PROGRAM_ID, GLOBAL_PDA, PUMP_FEE_CONFIG_PDA],
    "confirmed",
  );
  if (!program?.executable) {
    throw new PumpUnavailableError(`The Pump program (${PUMP_PROGRAM_ID.toBase58()}) is not deployed on this cluster.`);
  }
  if (!globalAccount?.owner.equals(PUMP_PROGRAM_ID)) {
    throw new PumpUnavailableError("The Pump Global account is missing on this cluster.");
  }
  if (!feeConfigAccount?.owner.equals(PUMP_FEE_PROGRAM_ID)) {
    throw new PumpUnavailableError("The Pump fee configuration is missing on this cluster.");
  }
  const global = PUMP_SDK.decodeGlobal(globalAccount);
  const tokenTotalSupply = fromBn(global.tokenTotalSupply);
  if (tokenTotalSupply !== PUMP_EXPECTED_TOTAL_SUPPLY) {
    throw new PumpUnavailableError(
      `The Pump protocol supply changed to ${tokenTotalSupply} base units; this app's displayed supply must be reviewed before launching.`,
    );
  }
  return {
    global,
    feeConfig: PUMP_SDK.decodeFeeConfig(feeConfigAccount),
    tokenTotalSupply,
    initialRealTokenReserves: fromBn(global.initialRealTokenReserves),
    createV2Enabled: global.createV2Enabled,
  };
}
