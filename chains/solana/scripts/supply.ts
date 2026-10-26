/** Prints the current supply of MINT. Read-only. */
import { runScript } from "@minthouse/config/cli";
import { formatTokenAmount } from "@minthouse/shared";
import { readMintState } from "@minthouse/blockchain/solana";
import { connect } from "./lib/context.js";
import { mintEnv, readEnv } from "./lib/env.js";

await runScript(async () => {
  const { MINT } = readEnv(mintEnv);
  const context = await connect();
  const state = await readMintState(context.connection, MINT.toBase58());
  console.log(`${formatTokenAmount(state.supply, state.decimals)} ${state.metadata?.symbol ?? ""} (${state.supply} base units)`);
});
