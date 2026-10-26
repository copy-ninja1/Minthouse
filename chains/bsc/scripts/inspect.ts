/** Prints verified on-chain state for TOKEN_ADDRESS. Read-only. */
import { formatTokenAmount } from "@minthouse/shared";
import { readErc20State } from "@minthouse/blockchain/bsc";
import { connect, explorerAddress } from "./lib/context.js";
import { readEnv, tokenEnv } from "./lib/env.js";
import { runScript } from "@minthouse/config/cli";

await runScript(async () => {
  const { TOKEN_ADDRESS } = readEnv(tokenEnv);
  const context = await connect();
  const state = await readErc20State(context.publicClient, TOKEN_ADDRESS);

  const rows: Record<string, string> = {
    Network: `${context.network.label} (chain ${context.chainId})`,
    Address: explorerAddress(context, state.address),
    Template: state.isLaunchpadToken ? "LaunchpadToken (bytecode verified)" : "Other ERC-20 (not a Minthouse template)",
    Name: state.name,
    Symbol: state.symbol,
    Decimals: String(state.decimals),
    "Total supply": `${formatTokenAmount(state.totalSupply, state.decimals)} (${state.totalSupply} base units)`,
  };
  if (state.isLaunchpadToken) {
    rows.Owner = state.owner ?? "unknown";
    rows["Pending owner"] = state.pendingOwner ?? "unknown";
    rows.Minting = state.mintingEnabled === null ? "unknown" : state.mintingEnabled ? "enabled (owner can mint)" : "permanently disabled";
  }
  for (const [key, value] of Object.entries(rows)) {
    console.log(`${key.padEnd(16)} ${value}`);
  }
});
