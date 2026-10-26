/** Prints verified on-chain state for MINT. Read-only. */
import { runScript } from "@minthouse/config/cli";
import { formatTokenAmount } from "@minthouse/shared";
import { readMintState } from "@minthouse/blockchain/solana";
import { connect, explorerAddress, printSummary } from "./lib/context.js";
import { mintEnv, readEnv } from "./lib/env.js";

await runScript(async () => {
  const { MINT } = readEnv(mintEnv);
  const context = await connect();
  const state = await readMintState(context.connection, MINT.toBase58());
  printSummary(state.metadata ? `${state.metadata.name} (${state.metadata.symbol})` : "Mint", {
    Network: context.network.label,
    Mint: explorerAddress(context, state.address),
    "Token program": state.tokenProgram,
    Decimals: String(state.decimals),
    Supply: `${formatTokenAmount(state.supply, state.decimals)} (${state.supply} base units)`,
    "Mint authority": state.mintAuthority ?? "revoked — supply is fixed",
    "Freeze authority": state.freezeAuthority ?? "none",
    Metadata: state.metadata ? `${state.metadata.source}: ${state.metadata.uri}` : "none found",
    "Update authority": state.metadata?.updateAuthority ?? "n/a",
    "Metadata mutable": state.metadata?.isMutable === null || !state.metadata ? "unknown" : String(state.metadata.isMutable),
  });
});
