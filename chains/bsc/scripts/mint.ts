/** Mints AMOUNT whole tokens of TOKEN_ADDRESS to RECIPIENT. Owner only, while minting is enabled. */
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
  const before = await readErc20State(context.publicClient, env.TOKEN_ADDRESS);

  if (!before.isLaunchpadToken) {
    throw new Error("Minting is only supported for LaunchpadToken contracts created by Minthouse.");
  }
  if (before.mintingEnabled !== true) {
    throw new Error("Minting is permanently disabled on this token.");
  }
  if (before.owner !== signer) {
    throw new Error(`Only the owner (${before.owner ?? "none"}) can mint. Signer is ${signer}.`);
  }

  const amount = parseTokenAmount(env.AMOUNT, before.decimals);
  await executeTokenCall(context, bscTokenActions.mint(env.TOKEN_ADDRESS, env.RECIPIENT, amount), {
    title: `Mint ${before.symbol}`,
    summary: {
      Token: `${before.name} (${before.address})`,
      Recipient: env.RECIPIENT,
      Amount: `${formatTokenAmount(amount, before.decimals)} ${before.symbol} (${amount} base units)`,
      "Supply after": formatTokenAmount(before.totalSupply + amount, before.decimals),
    },
    verify: async () => {
      const after = await readErc20State(context.publicClient, env.TOKEN_ADDRESS);
      const balance = await readErc20Balance(context.publicClient, env.TOKEN_ADDRESS, env.RECIPIENT);
      if (after.totalSupply !== before.totalSupply + amount) {
        throw new Error(`Supply is ${after.totalSupply}, expected ${before.totalSupply + amount}`);
      }
      return `supply ${formatTokenAmount(after.totalSupply, after.decimals)}, recipient balance ${formatTokenAmount(balance, after.decimals)}`;
    },
  });
});
