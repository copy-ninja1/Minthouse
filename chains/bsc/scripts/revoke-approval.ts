/** Sets the signer's allowance for SPENDER on TOKEN_ADDRESS to zero. */
import { bscTokenActions, readErc20Allowance, readErc20State } from "@minthouse/blockchain/bsc";
import { formatTokenAmount } from "@minthouse/shared";
import { connect, requireWallet } from "./lib/context.js";
import { readEnv, spenderEnv } from "./lib/env.js";
import { executeTokenCall } from "./lib/execute.js";
import { runScript } from "@minthouse/config/cli";

await runScript(async () => {
  const env = readEnv(spenderEnv);
  const context = await connect();
  const { signer } = requireWallet(context);
  const state = await readErc20State(context.publicClient, env.TOKEN_ADDRESS);
  const current = await readErc20Allowance(context.publicClient, env.TOKEN_ADDRESS, signer, env.SPENDER);
  if (current === 0n) {
    console.log("Allowance is already zero; nothing to do.");
    return;
  }

  await executeTokenCall(context, bscTokenActions.revokeApproval(env.TOKEN_ADDRESS, env.SPENDER), {
    title: `Revoke ${state.symbol} approval`,
    summary: { Token: state.address, Spender: env.SPENDER, "Current allowance": formatTokenAmount(current, state.decimals) },
    verify: async () => {
      const after = await readErc20Allowance(context.publicClient, env.TOKEN_ADDRESS, signer, env.SPENDER);
      if (after !== 0n) {
        throw new Error(`Allowance is still ${after}`);
      }
      return "allowance is 0";
    },
  });
});
