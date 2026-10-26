import { type Connection, PublicKey } from "@solana/web3.js";
import { PUMP_PROGRAM_ID } from "@pump-fun/pump-sdk";
import { PUMPFUN_TOKEN_DECIMALS, type PumpfunConfig } from "@minthouse/shared";
import type { SolanaDeploymentCheck } from "../solana/verify.js";
import { readMintState } from "../solana/state.js";
import { associatedTokenAddress } from "../solana/spl.js";
import { NotAPumpCoinError, loadPumpCurve } from "./coin.js";
import { PUMP_EXPECTED_TOTAL_SUPPLY } from "./protocol.js";

/**
 * Proves that a launch transaction created a genuine Pump.fun coin: the Pump
 * program executed in it, the bonding curve is owned by the Pump program and
 * records the creator, and the mint carries Pump's fixed supply, no mint or
 * freeze authority, and the requested metadata.
 */
export async function verifyPumpLaunch(
  connection: Connection,
  params: { signature: string; mint: string; creator: string; expected: Pick<PumpfunConfig, "name" | "symbol">; metadataUri: string },
): Promise<SolanaDeploymentCheck> {
  const tx = await connection.getTransaction(params.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!tx) {
    return { status: "pending" };
  }
  if (tx.meta?.err) {
    return { status: "failed", code: "REVERTED", reason: `Transaction failed: ${JSON.stringify(tx.meta.err)}` };
  }

  const mint = new PublicKey(params.mint);
  const creator = new PublicKey(params.creator);
  const details: Record<string, string> = { mint: mint.toBase58(), slot: String(tx.slot), program: PUMP_PROGRAM_ID.toBase58() };
  const fail = (reason: string): SolanaDeploymentCheck => ({ status: "mismatch", tokenAddress: mint.toBase58(), reason, details });

  const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta?.loadedAddresses ?? null });
  if (!keys.get(0)?.equals(creator)) {
    return fail("The transaction fee payer is not the recorded creator.");
  }
  if (!keys.staticAccountKeys.some((key) => key.equals(mint))) {
    return fail("The transaction does not reference the recorded mint.");
  }
  const invokedPump = tx.transaction.message.compiledInstructions.some((ix) => keys.get(ix.programIdIndex)?.equals(PUMP_PROGRAM_ID));
  if (!invokedPump) {
    return fail("The transaction did not call the Pump program.");
  }

  let curve;
  try {
    curve = (await loadPumpCurve(connection, mint)).curve;
  } catch (error) {
    if (error instanceof NotAPumpCoinError) {
      return fail(error.message);
    }
    throw error;
  }
  details.bondingCurveCreator = curve.creator.toBase58();
  if (!curve.creator.equals(creator)) {
    return fail("The bonding curve records a different creator.");
  }
  if (!curve.quoteMint.equals(PublicKey.default)) {
    return fail("The bonding curve is not SOL-quoted.");
  }

  const state = await readMintState(connection, mint.toBase58());
  details.tokenProgram = state.tokenProgram;
  details.decimals = String(state.decimals);
  details.supplyBaseUnits = state.supply.toString();
  details.mintAuthority = state.mintAuthority ?? "none";
  if (state.decimals !== PUMPFUN_TOKEN_DECIMALS || state.supply !== PUMP_EXPECTED_TOTAL_SUPPLY) {
    return fail("The mint does not carry Pump's fixed decimals and supply.");
  }
  if (state.mintAuthority !== null || state.freezeAuthority !== null) {
    return fail("The mint still has a mint or freeze authority.");
  }
  const metadata = state.metadata;
  if (!metadata) {
    return fail("The mint has no metadata.");
  }
  details.name = metadata.name;
  details.symbol = metadata.symbol;
  details.metadataUri = metadata.uri;
  if (metadata.name !== params.expected.name || metadata.symbol !== params.expected.symbol || metadata.uri !== params.metadataUri) {
    return fail("On-chain metadata differs from the requested name, symbol or URI.");
  }

  const creatorAccount = associatedTokenAddress(mint, creator, state.tokenProgramId).toBase58();
  const creatorPost = tx.meta?.postTokenBalances?.find(
    (balance) => balance.mint === mint.toBase58() && keys.get(balance.accountIndex)?.toBase58() === creatorAccount,
  );
  details.initialBuyTokens = creatorPost?.uiTokenAmount.amount ?? "0";
  return { status: "verified", tokenAddress: mint.toBase58(), slot: tx.slot, details };
}
