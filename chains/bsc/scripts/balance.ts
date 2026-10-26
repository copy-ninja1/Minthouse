/** Prints the TOKEN_ADDRESS balance of ACCOUNT (defaults to the configured signer). Read-only. */
import { formatTokenAmount } from "@minthouse/shared";
import { readErc20Balance, readErc20State } from "@minthouse/blockchain/bsc";
import { connect } from "./lib/context.js";
import { accountEnv, readEnv } from "./lib/env.js";
import { runScript } from "@minthouse/config/cli";

await runScript(async () => {
  const env = readEnv(accountEnv);
  const context = await connect();
  const account = env.ACCOUNT ?? context.wallet?.account.address;
  if (!account) {
    throw new Error("Set ACCOUNT to the address to inspect.");
  }
  const [state, balance] = await Promise.all([
    readErc20State(context.publicClient, env.TOKEN_ADDRESS),
    readErc20Balance(context.publicClient, env.TOKEN_ADDRESS, account),
  ]);
  console.log(`${account}: ${formatTokenAmount(balance, state.decimals)} ${state.symbol} (${balance} base units)`);
});
