import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { type Connection, PublicKey } from "@solana/web3.js";
import { type SplTokenConfig, type TxErrorCode, wholeTokensToBaseUnits } from "@minthouse/shared";
import { readMintState } from "./state.js";
import { associatedTokenAddress } from "./spl.js";

export type SolanaDeploymentCheck =
  | { status: "pending" }
  | { status: "failed"; code: TxErrorCode; reason: string }
  | { status: "verified"; tokenAddress: string; slot: number; details: Record<string, string> }
  | { status: "mismatch"; tokenAddress: string; reason: string; details: Record<string, string> };

/**
 * Proves a creation transaction produced the requested SPL token, using the
 * confirmed transaction itself plus current mint and metadata accounts.
 * Initial issuance is read from the transaction's own post-token-balances so
 * later transfers or mints cannot affect the result.
 */
export async function verifySplDeployment(
  connection: Connection,
  params: { signature: string; mint: string; creator: string; expected: SplTokenConfig; metadataUri: string },
): Promise<SolanaDeploymentCheck> {
  const tx = await connection.getTransaction(params.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!tx) {
    return { status: "pending" };
  }
  if (tx.meta?.err) {
    return { status: "failed", code: "REVERTED", reason: `Transaction failed: ${JSON.stringify(tx.meta.err)}` };
  }

  const { expected } = params;
  const mint = new PublicKey(params.mint);
  const details: Record<string, string> = { mint: mint.toBase58(), slot: String(tx.slot) };
  const fail = (reason: string): SolanaDeploymentCheck => ({ status: "mismatch", tokenAddress: mint.toBase58(), reason, details });

  const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta?.loadedAddresses ?? null });
  const feePayer = keys.get(0);
  if (!feePayer?.equals(new PublicKey(params.creator))) {
    return fail("The transaction fee payer is not the recorded creator.");
  }
  if (!keys.staticAccountKeys.some((key) => key.equals(mint))) {
    return fail("The transaction does not reference the recorded mint.");
  }

  const state = await readMintState(connection, mint.toBase58());
  details.tokenProgram = state.tokenProgram;
  details.decimals = String(state.decimals);
  details.mintAuthority = state.mintAuthority ?? "revoked";
  details.freezeAuthority = state.freezeAuthority ?? "none";
  if (!state.tokenProgramId.equals(TOKEN_PROGRAM_ID)) {
    return fail("The mint is not owned by the standard SPL Token program.");
  }
  if (state.decimals !== expected.decimals) {
    return fail("Decimals differ from the requested configuration.");
  }
  if (state.freezeAuthority !== null) {
    return fail("A freeze authority is set, but none was requested.");
  }
  // A retained authority may legitimately be transferred or revoked later, so
  // only the "revoke at creation" promise is checked against current state.
  if (expected.mintAuthority === "revoke" && state.mintAuthority !== null) {
    return fail("Mint authority was supposed to be revoked at creation but is still set.");
  }

  const metadata = state.metadata;
  if (!metadata) {
    return fail("No Metaplex metadata account exists for the mint.");
  }
  details.name = metadata.name;
  details.symbol = metadata.symbol;
  details.metadataUri = metadata.uri;
  details.metadataMutable = String(metadata.isMutable);
  if (metadata.name !== expected.name || metadata.symbol !== expected.symbol || metadata.uri !== params.metadataUri) {
    return fail("On-chain metadata differs from the requested name, symbol or URI.");
  }
  if (metadata.isMutable !== expected.metadataMutable) {
    return fail("Metadata mutability differs from the requested configuration.");
  }

  const expectedSupply = wholeTokensToBaseUnits(expected.initialSupply, expected.decimals);
  details.initialSupplyBaseUnits = expectedSupply.toString();
  if (expectedSupply > 0n) {
    const recipientAccount = associatedTokenAddress(mint, new PublicKey(expected.recipient)).toBase58();
    const post = tx.meta?.postTokenBalances?.find(
      (balance) => balance.mint === mint.toBase58() && keys.get(balance.accountIndex)?.toBase58() === recipientAccount,
    );
    if (!post || BigInt(post.uiTokenAmount.amount) !== expectedSupply) {
      return fail("The recipient did not receive the requested initial supply in the creation transaction.");
    }
    details.initialRecipient = expected.recipient;
  }
  return { status: "verified", tokenAddress: mint.toBase58(), slot: tx.slot, details };
}
