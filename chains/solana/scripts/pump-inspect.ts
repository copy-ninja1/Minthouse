/** Prints live Pump.fun bonding-curve state for MINT. Read-only. */
import { runScript } from "@minthouse/config/cli";
import { formatTokenAmount } from "@minthouse/shared";
import { fetchPumpProtocol, readPumpCoin } from "@minthouse/blockchain/pump";
import { readMintState } from "@minthouse/blockchain/solana";
import { connect, explorerAddress, formatSol, printSummary } from "./lib/context.js";
import { mintEnv, readEnv } from "./lib/env.js";

await runScript(async () => {
  const { MINT } = readEnv(mintEnv);
  const context = await connect();
  const protocol = await fetchPumpProtocol(context.connection);
  const coin = await readPumpCoin(context.connection, protocol, MINT);
  const mint = await readMintState(context.connection, MINT.toBase58());
  const phaseLabel = { bonding: "trading on the bonding curve", complete: "curve complete — awaiting migration", migrated: "migrated to PumpSwap" } as const;
  printSummary(mint.metadata ? `${mint.metadata.name} (${mint.metadata.symbol}) — Pump.fun` : "Pump.fun coin", {
    Network: context.network.label,
    Mint: explorerAddress(context, coin.mint),
    "Bonding curve": coin.bondingCurve,
    Creator: coin.creator,
    Phase: phaseLabel[coin.phase],
    "Curve progress": `${(coin.progressBps / 100).toFixed(2)}%`,
    "Total supply": formatTokenAmount(coin.tokenTotalSupply, mint.decimals),
    "Tokens left on curve": formatTokenAmount(coin.realTokenReserves, mint.decimals),
    "SOL in curve": `${formatSol(coin.realQuoteReserves)} SOL`,
    "Implied market cap": coin.marketCapQuote === null ? "n/a" : `${formatSol(coin.marketCapQuote)} SOL (from curve reserves)`,
    "PumpSwap pool": coin.phase === "migrated" ? coin.pool : "not yet",
    Metadata: mint.metadata?.uri ?? "none",
  });
});
