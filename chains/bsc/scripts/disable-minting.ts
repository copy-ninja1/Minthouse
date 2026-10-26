/** Permanently disables minting on TOKEN_ADDRESS, fixing its supply. Requires a typed confirmation. */
import { formatTokenAmount } from "@minthouse/shared";
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
  if (!state.mintingEnabled) {
    throw new Error("Minting is already disabled.");
  }

  await executeTokenCall(context, bscTokenActions.disableMinting(env.TOKEN_ADDRESS), {
    title: `Permanently disable minting for ${state.symbol}`,
    summary: { Token: state.address, "Final supply": `${formatTokenAmount(state.totalSupply, state.decimals)} ${state.symbol}` },
    irreversible: {
      phrase: `disable minting for ${state.address} on ${context.network.id}`,
      warning: "Supply becomes fixed forever. This cannot be undone.",
    },
    verify: async () => {
      const after = await readErc20State(context.publicClient, env.TOKEN_ADDRESS);
      if (after.mintingEnabled !== false) {
        throw new Error("Minting is still enabled");
      }
      return "minting permanently disabled";
    },
  });
});
