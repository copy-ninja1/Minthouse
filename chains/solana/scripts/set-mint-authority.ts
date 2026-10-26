/** Transfers mint authority of MINT from the keypair to NEW_AUTHORITY. */
import { runScript } from "@minthouse/config/cli";
import { readMintState, setMintAuthorityInstructions } from "@minthouse/blockchain/solana";
import { connect, simulateConfirmAndSend } from "./lib/context.js";
import { newAuthorityEnv, readEnv } from "./lib/env.js";

await runScript(async () => {
  const env = readEnv(newAuthorityEnv);
  const context = await connect();
  const current = context.signer.publicKey;
  const state = await readMintState(context.connection, env.MINT.toBase58());
  if (state.mintAuthority !== current.toBase58()) {
    throw new Error(`Mint authority is ${state.mintAuthority ?? "revoked"}, not ${current.toBase58()}.`);
  }

  await simulateConfirmAndSend(context, {
    title: "Transfer mint authority",
    instructions: setMintAuthorityInstructions({ mint: env.MINT, tokenProgram: state.tokenProgramId }, { currentAuthority: current, newAuthority: env.NEW_AUTHORITY }),
    summary: { Mint: env.MINT.toBase58(), "Current authority": current.toBase58(), "New authority": env.NEW_AUTHORITY.toBase58() },
    irreversible: {
      phrase: `give mint authority of ${env.MINT.toBase58()} to ${env.NEW_AUTHORITY.toBase58()}`,
      warning: "Only the new authority can mint or move authority afterwards. You cannot take it back.",
    },
  });

  const after = await readMintState(context.connection, env.MINT.toBase58());
  if (after.mintAuthority !== env.NEW_AUTHORITY.toBase58()) {
    throw new Error(`Mint authority is ${after.mintAuthority ?? "revoked"}.`);
  }
  console.log(`Verified on-chain: mint authority is ${after.mintAuthority}`);
});
