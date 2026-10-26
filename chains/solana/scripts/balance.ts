/** Prints the MINT balance of OWNER (defaults to the configured keypair). Read-only. */
import { runScript } from "@minthouse/config/cli";
import { formatTokenAmount } from "@minthouse/shared";
import { associatedTokenAddress, readMintState, readTokenBalance } from "@minthouse/blockchain/solana";
import { connect } from "./lib/context.js";
import { ownerEnv, readEnv } from "./lib/env.js";

await runScript(async () => {
  const env = readEnv(ownerEnv);
  const context = await connect();
  const owner = env.OWNER ?? context.signer.publicKey;
  const state = await readMintState(context.connection, env.MINT.toBase58());
  const balance = await readTokenBalance(context.connection, { mint: env.MINT, owner, tokenProgram: state.tokenProgramId });
  const account = associatedTokenAddress(env.MINT, owner, state.tokenProgramId);
  console.log(`${owner.toBase58()}: ${formatTokenAmount(balance, state.decimals)} ${state.metadata?.symbol ?? ""}`);
  console.log(`Token account: ${account.toBase58()}`);
});
