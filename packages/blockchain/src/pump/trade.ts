import { type Connection, PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  type BondingCurve,
  PUMP_SDK,
  getBuyTokenAmountFromSolAmount,
  getFeeRecipient,
  getSellSolAmountFromTokenAmount,
} from "@pump-fun/pump-sdk";
import { MAX_SLIPPAGE_BPS } from "@minthouse/shared";
import { type PumpCurveContext, loadPumpCurve } from "./coin.js";
import { type PumpProtocol, fromBn, toBn } from "./protocol.js";

export class PumpTradeError extends Error {
  override readonly name = "PumpTradeError";
}

export type PumpBuyQuote = {
  /** SOL the quote is based on, in lamports. */
  lamportsIn: bigint;
  /** Exact token amount the buy instruction requests. */
  tokensOut: bigint;
  /** The program refuses the buy if it would cost more than this. */
  maxCostLamports: bigint;
  slippageBps: number;
};

export type PumpSellQuote = {
  tokensIn: bigint;
  /** Expected proceeds after protocol and creator fees. */
  lamportsOut: bigint;
  /** The program refuses the sell if it would pay less than this. */
  minLamportsOut: bigint;
  slippageBps: number;
};

/** SOL curves pay the buyback slice to any listed `Global.buybackFeeRecipients` wallet. */
function buybackFeeRecipient(protocol: PumpProtocol): PublicKey {
  const listed = protocol.global.buybackFeeRecipients.filter((key) => !key.equals(PublicKey.default));
  const chosen = listed[Math.floor(Math.random() * listed.length)];
  if (!chosen) {
    throw new PumpTradeError("The Pump Global account lists no buyback fee recipient.");
  }
  return chosen;
}

function assertSlippage(slippageBps: number): void {
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > MAX_SLIPPAGE_BPS) {
    throw new PumpTradeError(`Slippage must be between 1 and ${MAX_SLIPPAGE_BPS} basis points.`);
  }
}

function assertTradable(curve: BondingCurve): void {
  if (curve.complete || curve.virtualTokenReserves.isZero()) {
    throw new PumpTradeError("This coin has left its bonding curve. It trades on PumpSwap, which this app does not route.");
  }
  if (!curve.quoteMint.equals(PublicKey.default)) {
    throw new PumpTradeError("Only SOL-quoted Pump coins are supported.");
  }
}

/** Quotes a SOL-in buy against a curve. Pure: uses only the supplied state. */
export function quotePumpBuy(protocol: PumpProtocol, curve: BondingCurve, lamportsIn: bigint, slippageBps: number): PumpBuyQuote {
  assertSlippage(slippageBps);
  if (lamportsIn <= 0n) {
    throw new PumpTradeError("Buy amount must be greater than zero.");
  }
  const tokensOut = fromBn(
    getBuyTokenAmountFromSolAmount({
      global: protocol.global,
      feeConfig: protocol.feeConfig,
      mintSupply: curve.tokenTotalSupply,
      bondingCurve: curve,
      amount: toBn(lamportsIn),
      quoteMint: curve.quoteMint,
    }),
  );
  if (tokensOut <= 0n) {
    throw new PumpTradeError("That amount buys no tokens at the current price.");
  }
  return { lamportsIn, tokensOut, maxCostLamports: (lamportsIn * BigInt(10_000 + slippageBps)) / 10_000n, slippageBps };
}

/** Quotes a token-in sell against a curve. Pure: uses only the supplied state. */
export function quotePumpSell(protocol: PumpProtocol, curve: BondingCurve, tokensIn: bigint, slippageBps: number): PumpSellQuote {
  assertSlippage(slippageBps);
  if (tokensIn <= 0n) {
    throw new PumpTradeError("Sell amount must be greater than zero.");
  }
  const lamportsOut = fromBn(
    getSellSolAmountFromTokenAmount({
      global: protocol.global,
      feeConfig: protocol.feeConfig,
      mintSupply: curve.tokenTotalSupply,
      bondingCurve: curve,
      amount: toBn(tokensIn),
    }),
  );
  return { tokensIn, lamportsOut, minLamportsOut: (lamportsOut * BigInt(10_000 - slippageBps)) / 10_000n, slippageBps };
}

/** Buy instruction for an exact token amount with a hard SOL cost ceiling. */
export async function pumpBuyInstruction(params: {
  protocol: PumpProtocol;
  mint: PublicKey;
  user: PublicKey;
  creator: PublicKey;
  isMayhemMode: boolean;
  tokenProgram: PublicKey;
  quote: PumpBuyQuote;
}): Promise<TransactionInstruction[]> {
  const associatedUser = getAssociatedTokenAddressSync(params.mint, params.user, true, params.tokenProgram);
  return [
    createAssociatedTokenAccountIdempotentInstruction(params.user, associatedUser, params.user, params.mint, params.tokenProgram),
    await PUMP_SDK.getBuyInstructionRaw({
      user: params.user,
      mint: params.mint,
      creator: params.creator,
      amount: toBn(params.quote.tokensOut),
      solAmount: toBn(params.quote.maxCostLamports),
      feeRecipient: getFeeRecipient(params.protocol.global, params.isMayhemMode),
      buybackFeeRecipient: buybackFeeRecipient(params.protocol),
      tokenProgram: params.tokenProgram,
    }),
  ];
}

export type PumpTradePlan<Q> = { instructions: TransactionInstruction[]; quote: Q; context: PumpCurveContext };

/** Builds a buy of `lamports` worth of a bonding-curve coin. Nothing is sent. */
export async function planPumpBuy(
  connection: Connection,
  protocol: PumpProtocol,
  params: { mint: PublicKey; user: PublicKey; lamports: bigint; slippageBps: number },
): Promise<PumpTradePlan<PumpBuyQuote>> {
  const context = await loadPumpCurve(connection, params.mint);
  assertTradable(context.curve);
  const quote = quotePumpBuy(protocol, context.curve, params.lamports, params.slippageBps);
  const instructions = await pumpBuyInstruction({
    protocol,
    mint: params.mint,
    user: params.user,
    creator: context.curve.creator,
    isMayhemMode: context.curve.isMayhemMode,
    tokenProgram: context.tokenProgramId,
    quote,
  });
  return { instructions, quote, context };
}

/** Builds a sell of `tokens` base units with a hard SOL proceeds floor. Nothing is sent. */
export async function planPumpSell(
  connection: Connection,
  protocol: PumpProtocol,
  params: { mint: PublicKey; user: PublicKey; tokens: bigint; slippageBps: number },
): Promise<PumpTradePlan<PumpSellQuote>> {
  const context = await loadPumpCurve(connection, params.mint);
  assertTradable(context.curve);
  const quote = quotePumpSell(protocol, context.curve, params.tokens, params.slippageBps);
  const instruction = await PUMP_SDK.getSellInstructionRaw({
    user: params.user,
    mint: params.mint,
    creator: context.curve.creator,
    amount: toBn(quote.tokensIn),
    solAmount: toBn(quote.minLamportsOut),
    feeRecipient: getFeeRecipient(protocol.global, context.curve.isMayhemMode),
    buybackFeeRecipient: buybackFeeRecipient(protocol),
    tokenProgram: context.tokenProgramId,
    cashback: context.curve.isCashbackCoin,
  });
  return { instructions: [instruction], quote, context };
}
