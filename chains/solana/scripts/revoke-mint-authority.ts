/** Permanently revokes mint authority of MINT, fixing supply forever. */
import { runScript } from "@minthouse/config/cli";
import { formatTokenAmount } from "@minthouse/shared";
import { readMintState, setMintAuthorityInstructions } from "@minthouse/blockchain/solana";
import { connect, simulateConfirmAndSend } from "./lib/context.js";
import { mintEnv, readEnv } from "./lib/env.js";

await runScript(async () => {
  const { MINT } = readEnv(mintEnv);
  const context = await connect();
  const current = context.signer.publicKey;
  const state = await readMintState(context.connection, MINT.toBase58());
  if (state.mintAuthority !== current.toBase58()) {
    throw new Error(`Mint authority is ${state.mintAuthority ?? "already revoked"}, not ${current.toBase58()}.`);
  }

  await simulateConfirmAndSend(context, {
    title: "REVOKE mint authority",
    instructions: setMintAuthorityInstructions({ mint: MINT, tokenProgram: state.tokenProgramId }, { currentAuthority: current, newAuthority: null }),
    summary: { Mint: MINT.toBase58(), "Final supply": formatTokenAmount(state.supply, state.decimals) },
    irreversible: {
      phrase: `revoke mint authority of ${MINT.toBase58()} on ${context.network.id}`,
      warning: "Supply becomes fixed forever. Nobody will ever be able to mint this token again.",
    },
  });

  const after = await readMintState(context.connection, MINT.toBase58());
  if (after.mintAuthority !== null) {
    throw new Error(`Mint authority is still ${after.mintAuthority}.`);
  }
  console.log("Verified on-chain: mint authority revoked; supply is fixed.");
});
