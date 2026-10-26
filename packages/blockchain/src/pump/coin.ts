import { type AccountInfo, type Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  type BondingCurve,
  PUMP_PROGRAM_ID,
  PUMP_SDK,
  bondingCurveMarketCap,
  bondingCurvePda,
  canonicalPumpPoolPda,
  isBondingCurveMigrated,
} from "@pump-fun/pump-sdk";
import { type PumpProtocol, fromBn } from "./protocol.js";

/**
 * - `bonding`: trading on the bonding curve.
 * - `complete`: the curve sold out and awaits migration; it no longer trades.
 * - `migrated`: liquidity moved to the canonical PumpSwap pool.
 */
export type PumpCoinPhase = "bonding" | "complete" | "migrated";

export type PumpCoinState = {
  mint: string;
  bondingCurve: string;
  creator: string;
  phase: PumpCoinPhase;
  /** null for SOL-quoted coins; otherwise the quote mint. */
  quoteMint: string | null;
  isMayhemMode: boolean;
  isCashbackCoin: boolean;
  tokenProgram: "spl-token" | "token-2022";
  tokenTotalSupply: bigint;
  virtualTokenReserves: bigint;
  virtualQuoteReserves: bigint;
  realTokenReserves: bigint;
  realQuoteReserves: bigint;
  /** Share of the curve's sellable tokens already bought, in basis points. */
  progressBps: number;
  /** Fully diluted value implied by the curve, in quote base units; null once migrated. */
  marketCapQuote: bigint | null;
  /** Canonical PumpSwap pool address (exists only after migration). */
  pool: string;
};

/** Everything trade builders need about a curve, kept internal to this module. */
export type PumpCurveContext = {
  mint: PublicKey;
  accountInfo: AccountInfo<Buffer>;
  curve: BondingCurve;
  tokenProgramId: PublicKey;
};

export class NotAPumpCoinError extends Error {
  override readonly name = "NotAPumpCoinError";
}

export async function loadPumpCurve(connection: Connection, mint: PublicKey): Promise<PumpCurveContext> {
  const [curveAccount, mintAccount] = await connection.getMultipleAccountsInfo([bondingCurvePda(mint), mint], "confirmed");
  if (!mintAccount) {
    throw new NotAPumpCoinError(`No mint exists at ${mint.toBase58()} on this cluster.`);
  }
  if (!curveAccount?.owner.equals(PUMP_PROGRAM_ID)) {
    throw new NotAPumpCoinError(`${mint.toBase58()} has no Pump bonding curve; it was not launched through Pump.fun.`);
  }
  if (!mintAccount.owner.equals(TOKEN_PROGRAM_ID) && !mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    throw new NotAPumpCoinError(`${mint.toBase58()} is not a token mint.`);
  }
  return { mint, accountInfo: curveAccount, curve: PUMP_SDK.decodeBondingCurve(curveAccount), tokenProgramId: mintAccount.owner };
}

export function describePumpCurve(protocol: PumpProtocol, context: PumpCurveContext): PumpCoinState {
  const { curve, mint } = context;
  const migrated = isBondingCurveMigrated(curve);
  const phase: PumpCoinPhase = migrated ? "migrated" : curve.complete ? "complete" : "bonding";
  const realTokenReserves = fromBn(curve.realTokenReserves);
  const initial = protocol.initialRealTokenReserves;
  const sold = initial > realTokenReserves ? initial - realTokenReserves : 0n;
  const progressBps = phase === "bonding" && initial > 0n ? Number((sold * 10_000n) / initial) : 10_000;
  return {
    mint: mint.toBase58(),
    bondingCurve: bondingCurvePda(mint).toBase58(),
    creator: curve.creator.toBase58(),
    phase,
    quoteMint: curve.quoteMint.equals(PublicKey.default) ? null : curve.quoteMint.toBase58(),
    isMayhemMode: curve.isMayhemMode,
    isCashbackCoin: curve.isCashbackCoin,
    tokenProgram: context.tokenProgramId.equals(TOKEN_2022_PROGRAM_ID) ? "token-2022" : "spl-token",
    tokenTotalSupply: fromBn(curve.tokenTotalSupply),
    virtualTokenReserves: fromBn(curve.virtualTokenReserves),
    virtualQuoteReserves: fromBn(curve.virtualQuoteReserves),
    realTokenReserves,
    realQuoteReserves: fromBn(curve.realQuoteReserves),
    progressBps,
    marketCapQuote: curve.virtualTokenReserves.isZero()
      ? null
      : fromBn(
          bondingCurveMarketCap({
            mintSupply: curve.tokenTotalSupply,
            virtualQuoteReserves: curve.virtualQuoteReserves,
            virtualTokenReserves: curve.virtualTokenReserves,
          }),
        ),
    pool: canonicalPumpPoolPda(mint).toBase58(),
  };
}

/** Reads a Pump coin's live bonding-curve state from chain. */
export async function readPumpCoin(connection: Connection, protocol: PumpProtocol, mint: PublicKey): Promise<PumpCoinState> {
  return describePumpCurve(protocol, await loadPumpCurve(connection, mint));
}
