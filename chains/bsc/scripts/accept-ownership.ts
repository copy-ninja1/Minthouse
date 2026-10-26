/** Step 2 of 2: the nominated owner accepts ownership of TOKEN_ADDRESS. */
import { bscTokenActions, readErc20State } from "@minthouse/blockchain/bsc";
import { connect, requireWallet } from "./lib/context.js";
import { readEnv, tokenEnv } from "./lib/env.js";
import { executeTokenCall } from "./lib/execute.js";
import { runScript } from "@minthouse/config/cli";

await runScript(async () => {
  const env = readEnv(tokenEnv);
  const context = await connect();
  const { signer } = requireWallet(context);
  const state = await readErc20State(context.publicClient, env.TOKEN_ADDRESS);
  if (state.pendingOwner !== signer) {
    throw new Error(`Signer ${signer} is not the pending owner (${state.pendingOwner ?? "none"}).`);
  }

  await executeTokenCall(context, bscTokenActions.acceptOwnership(env.TOKEN_ADDRESS), {
    title: `Accept ownership of ${state.symbol}`,
    summary: { Token: state.address, "Previous owner": state.owner ?? "none", "New owner": signer },
    verify: async () => {
      const after = await readErc20State(context.publicClient, env.TOKEN_ADDRESS);
      if (after.owner !== signer) {
        throw new Error(`Owner is ${after.owner ?? "none"}`);
      }
      return `owner is now ${after.owner}`;
    },
  });
});
