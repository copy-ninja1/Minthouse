/** Prints the current total supply of TOKEN_ADDRESS. Read-only. */
import { formatTokenAmount } from "@minthouse/shared";
import { readErc20State } from "@minthouse/blockchain/bsc";
import { connect } from "./lib/context.js";
import { readEnv, tokenEnv } from "./lib/env.js";
import { runScript } from "@minthouse/config/cli";

await runScript(async () => {
  const { TOKEN_ADDRESS } = readEnv(tokenEnv);
  const context = await connect();
  const state = await readErc20State(context.publicClient, TOKEN_ADDRESS);
  console.log(`${formatTokenAmount(state.totalSupply, state.decimals)} ${state.symbol} (${state.totalSupply} base units)`);
});
