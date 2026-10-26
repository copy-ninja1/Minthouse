/** Burns AMOUNT whole tokens of TOKEN_ADDRESS from the signer's own balance. */
import { formatTokenAmount, parseTokenAmount } from "@minthouse/shared";
import { bscTokenActions, readErc20Balance, readErc20State } from "@minthouse/blockchain/bsc";
import { connect, requireWallet } from "./lib/context.js";
import { amountEnv, readEnv } from "./lib/env.js";
import { executeTokenCall } from "./lib/execute.js";
import { runScript } from "@minthouse/config/cli";

await runScript(async () => {
  const env = readEnv(amountEnv);
  const context = await connect();
  const { signer } = requireWallet(context);
  const before = await readErc20State(context.publicClient, env.TOKEN_ADDRESS);
  if (!before.isLaunchpadToken) {
    throw new Error("Burning is only supported for LaunchpadToken contracts, which implement ERC20Burnable.");
  }
  const amount = parseTokenAmount(env.AMOUNT, before.decimals);
  const balance = await readErc20Balance(context.publicClient, env.TOKEN_ADDRESS, signer);
  if (balance < amount) {
    throw new Error(`Balance ${formatTokenAmount(balance, before.decimals)} is below ${env.AMOUNT}.`);
  }

  await executeTokenCall(context, bscTokenActions.burn(env.TOKEN_ADDRESS, amount), {
    title: `Burn ${before.symbol}`,
    summary: {
      Token: `${before.name} (${before.address})`,
      Amount: `${formatTokenAmount(amount, before.decimals)} ${before.symbol}`,
      "Supply after": formatTokenAmount(before.totalSupply - amount, before.decimals),
    },
    irreversible: {
      phrase: `burn ${env.AMOUNT} ${before.symbol}`,
      warning: "Burned tokens are destroyed permanently.",
    },
    verify: async () => {
      const after = await readErc20State(context.publicClient, env.TOKEN_ADDRESS);
      if (after.totalSupply !== before.totalSupply - amount) {
        throw new Error(`Supply is ${after.totalSupply}, expected ${before.totalSupply - amount}`);
      }
      return `supply ${formatTokenAmount(after.totalSupply, after.decimals)} ${after.symbol}`;
    },
  });
});
