/** Prints how much SPENDER may move from OWNER (defaults to the signer). Read-only. */
import { formatTokenAmount } from "@minthouse/shared";
import { readErc20Allowance, readErc20State } from "@minthouse/blockchain/bsc";
import { connect } from "./lib/context.js";
import { readEnv, spenderEnv } from "./lib/env.js";
import { runScript } from "@minthouse/config/cli";

await runScript(async () => {
  const env = readEnv(spenderEnv);
  const context = await connect();
  const owner = env.OWNER ?? context.wallet?.account.address;
  if (!owner) {
    throw new Error("Set OWNER to the token holder to inspect.");
  }
  const [state, allowance] = await Promise.all([
    readErc20State(context.publicClient, env.TOKEN_ADDRESS),
    readErc20Allowance(context.publicClient, env.TOKEN_ADDRESS, owner, env.SPENDER),
  ]);
  console.log(`${env.SPENDER} may spend ${formatTokenAmount(allowance, state.decimals)} ${state.symbol} from ${owner}`);
});
