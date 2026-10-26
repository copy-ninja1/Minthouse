/** Transfers AMOUNT whole tokens of TOKEN_ADDRESS from the signer to RECIPIENT. */
import { formatTokenAmount, parseTokenAmount } from "@minthouse/shared";
import { bscTokenActions, readErc20Balance, readErc20State } from "@minthouse/blockchain/bsc";
import { connect, requireWallet } from "./lib/context.js";
import { readEnv, recipientAmountEnv } from "./lib/env.js";
import { executeTokenCall } from "./lib/execute.js";
import { runScript } from "@minthouse/config/cli";

await runScript(async () => {
  const env = readEnv(recipientAmountEnv);
  const context = await connect();
  const { signer } = requireWallet(context);
  const state = await readErc20State(context.publicClient, env.TOKEN_ADDRESS);
  const amount = parseTokenAmount(env.AMOUNT, state.decimals);
  const [senderBefore, recipientBefore] = await Promise.all([
    readErc20Balance(context.publicClient, env.TOKEN_ADDRESS, signer),
    readErc20Balance(context.publicClient, env.TOKEN_ADDRESS, env.RECIPIENT),
  ]);
  if (senderBefore < amount) {
    throw new Error(`Balance ${formatTokenAmount(senderBefore, state.decimals)} is below ${env.AMOUNT}.`);
  }

  await executeTokenCall(context, bscTokenActions.transfer(env.TOKEN_ADDRESS, env.RECIPIENT, amount), {
    title: `Transfer ${state.symbol}`,
    summary: {
      Token: `${state.name} (${state.address})`,
      Recipient: env.RECIPIENT,
      Amount: `${formatTokenAmount(amount, state.decimals)} ${state.symbol}`,
    },
    verify: async () => {
      const recipientAfter = await readErc20Balance(context.publicClient, env.TOKEN_ADDRESS, env.RECIPIENT);
      if (env.RECIPIENT !== signer && recipientAfter !== recipientBefore + amount) {
        throw new Error("Recipient balance did not increase by the transferred amount.");
      }
      return `recipient balance ${formatTokenAmount(recipientAfter, state.decimals)} ${state.symbol}`;
    },
  });
});
