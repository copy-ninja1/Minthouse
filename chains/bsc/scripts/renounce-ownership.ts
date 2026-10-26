/** Permanently renounces ownership of TOKEN_ADDRESS. Requires a typed confirmation on every network. */
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
  if (!state.isLaunchpadToken || state.owner !== signer) {
    throw new Error(`Signer ${signer} is not the owner (${state.owner ?? "unknown"}).`);
  }

  await executeTokenCall(context, bscTokenActions.renounceOwnership(env.TOKEN_ADDRESS), {
    title: `RENOUNCE ownership of ${state.symbol}`,
    summary: {
      Token: state.address,
      Owner: state.owner,
      Minting: state.mintingEnabled ? "enabled — will become impossible for anyone" : "already disabled",
    },
    irreversible: {
      phrase: `renounce ownership of ${state.address} on ${context.network.id}`,
      warning: "After renouncing, nobody can ever mint, disable minting, or transfer ownership again.",
    },
    verify: async () => {
      const after = await readErc20State(context.publicClient, env.TOKEN_ADDRESS);
      if (after.owner !== "0x0000000000000000000000000000000000000000") {
        throw new Error(`Owner is still ${after.owner ?? "unknown"}`);
      }
      return "owner is the zero address; the token has no owner";
    },
  });
});
