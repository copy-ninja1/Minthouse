import { Keypair, PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { PUMP_SDK, newBondingCurve } from "@pump-fun/pump-sdk";
import { type PumpfunConfig, SOLANA_URI_MAX_BYTES, SOL_DECIMALS, parseTokenAmount, utf8ByteLength } from "@minthouse/shared";
import { type PumpProtocol, PumpUnavailableError } from "./protocol.js";
import { type PumpBuyQuote, pumpBuyInstruction, quotePumpBuy } from "./trade.js";

export type PumpLaunchPlan = {
  /** Fresh mint keypair; it must co-sign the launch transaction. */
  mint: Keypair;
  instructions: TransactionInstruction[];
  tokenProgram: PublicKey;
  /** The creator's optional first buy, quoted against a brand-new curve. */
  initialBuy: PumpBuyQuote | null;
};

/**
 * Builds a genuine Pump.fun launch through the official program's `create_v2`
 * instruction: a SOL-quoted bonding curve, not mayhem mode, not a
 * holder-reward coin. The Pump program creates the Token-2022 mint, its
 * metadata and the curve, and mints the fixed supply into the curve.
 *
 * An initial buy is included only when the creator explicitly configured one;
 * it executes atomically with the launch and is bounded by `slippageBps`.
 */
export async function planPumpLaunch(
  protocol: PumpProtocol,
  params: { creator: PublicKey; config: PumpfunConfig; metadataUri: string; mint?: Keypair },
): Promise<PumpLaunchPlan> {
  if (!protocol.createV2Enabled) {
    throw new PumpUnavailableError("Pump.fun coin creation (create_v2) is currently disabled on this cluster.");
  }
  if (!params.metadataUri.startsWith("https://") || utf8ByteLength(params.metadataUri) > SOLANA_URI_MAX_BYTES) {
    throw new RangeError(`The metadata URI must be an https URL of at most ${SOLANA_URI_MAX_BYTES} bytes.`);
  }
  const { creator, config } = params;
  const mint = params.mint ?? Keypair.generate();
  const instructions = [
    await PUMP_SDK.createV2Instruction({
      mint: mint.publicKey,
      name: config.name,
      symbol: config.symbol,
      uri: params.metadataUri,
      creator,
      user: creator,
      mayhemMode: false,
    }),
  ];

  const lamports = parseTokenAmount(config.initialBuySol, SOL_DECIMALS);
  let initialBuy: PumpBuyQuote | null = null;
  if (lamports > 0n) {
    const curve = { ...newBondingCurve(protocol.global, PublicKey.default), creator, isMayhemMode: false };
    initialBuy = quotePumpBuy(protocol, curve, lamports, config.slippageBps);
    instructions.push(
      ...(await pumpBuyInstruction({
        protocol,
        mint: mint.publicKey,
        user: creator,
        creator,
        isMayhemMode: false,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        quote: initialBuy,
      })),
    );
  }
  return { mint, instructions, tokenProgram: TOKEN_2022_PROGRAM_ID, initialBuy };
}
