/**
 * Step 1 of 2: nominates NEW_OWNER for TOKEN_ADDRESS. Ownership only moves
 * when NEW_OWNER runs `accept-ownership`, so a mistyped address cannot take control.
 */
import { bscTokenActions, readErc20State } from "@minthouse/blockchain/bsc";
import { connect, requireWallet } from "./lib/context.js";
import { newOwnerEnv, readEnv } from "./lib/env.js";
import { executeTokenCall } from "./lib/execute.js";
import { runScript } from "@minthouse/config/cli";

await runScript(async () => {
  const env = readEnv(newOwnerEnv);
  const context = await connect();
  const { signer } = requireWallet(context);
  const state = await readErc20State(context.publicClient, env.TOKEN_ADDRESS);
  if (!state.isLaunchpadToken || state.owner !== signer) {
    throw new Error(`Signer ${signer} is not the owner (${state.owner ?? "unknown"}).`);
  }

  await executeTokenCall(context, bscTokenActions.transferOwnership(env.TOKEN_ADDRESS, env.NEW_OWNER), {
    title: `Nominate new owner for ${state.symbol}`,
    summary: { Token: state.address, "Current owner": state.owner, "Nominated owner": env.NEW_OWNER },
    verify: async () => {
      const after = await readErc20State(context.publicClient, env.TOKEN_ADDRESS);
      if (after.pendingOwner !== env.NEW_OWNER) {
        throw new Error(`Pending owner is ${after.pendingOwner ?? "none"}`);
      }
      return `pending owner ${after.pendingOwner}; they must run accept-ownership to complete the transfer`;
    },
  });
});
