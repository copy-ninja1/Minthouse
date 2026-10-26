/**
 * Launches a coin through the official Pump program (create_v2). The Pump
 * program fixes supply and decimals and owns the bonding curve. An initial
 * buy runs only when PUMP_INITIAL_BUY_SOL is set above zero.
 *
 *   PUMP_TOKEN_NAME PUMP_TOKEN_SYMBOL PUMP_TOKEN_METADATA_URI
 *   [PUMP_INITIAL_BUY_SOL=0] [PUMP_SLIPPAGE_BPS=100]
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { parseCliEnv, runScript } from "@minthouse/config/cli";
import { PUMPFUN_TOKEN_DECIMALS, formatTokenAmount, parseSafeHttpsUrl, pumpfunConfigSchema } from "@minthouse/shared";
import { fetchPumpProtocol, planPumpLaunch, verifyPumpLaunch } from "@minthouse/blockchain/pump";
import { connect, explorerAddress, formatSol, simulateConfirmAndSend } from "./lib/context.js";

const pumpLaunchEnv = z.object({
  PUMP_TOKEN_NAME: z.string(),
  PUMP_TOKEN_SYMBOL: z.string(),
  PUMP_TOKEN_METADATA_URI: z.string().refine((value) => parseSafeHttpsUrl(value) !== null, "Must be an https URL"),
  PUMP_INITIAL_BUY_SOL: z.string().default("0"),
  PUMP_SLIPPAGE_BPS: z.coerce.number().int().default(100),
});

await runScript(async () => {
  const env = parseCliEnv(pumpLaunchEnv);
  const context = await connect();
  const creator = context.signer.publicKey;
  const config = pumpfunConfigSchema.parse({
    mode: "pumpfun",
    network: context.network.id,
    name: env.PUMP_TOKEN_NAME,
    symbol: env.PUMP_TOKEN_SYMBOL,
    description: "",
    initialBuySol: env.PUMP_INITIAL_BUY_SOL,
    slippageBps: env.PUMP_SLIPPAGE_BPS,
  });
  const protocol = await fetchPumpProtocol(context.connection);
  const plan = await planPumpLaunch(protocol, { creator, config, metadataUri: env.PUMP_TOKEN_METADATA_URI });

  const signature = await simulateConfirmAndSend(context, {
    title: `Launch ${config.symbol} on Pump.fun`,
    instructions: plan.instructions,
    extraSigners: [plan.mint],
    summary: {
      Program: "Pump (official) — create_v2, SOL-quoted bonding curve",
      Mint: `${plan.mint.publicKey.toBase58()} (new)`,
      Name: config.name,
      Symbol: config.symbol,
      Supply: `${formatTokenAmount(protocol.tokenTotalSupply, PUMPFUN_TOKEN_DECIMALS)} (fixed by the Pump program, held by the curve)`,
      "Mint authority": "none — removed by the Pump program",
      "Metadata URI": env.PUMP_TOKEN_METADATA_URI,
      "Initial buy": plan.initialBuy
        ? `${formatSol(plan.initialBuy.lamportsIn)} SOL for ${formatTokenAmount(plan.initialBuy.tokensOut, PUMPFUN_TOKEN_DECIMALS)} tokens (max ${formatSol(plan.initialBuy.maxCostLamports)} SOL)`
        : "none",
    },
  });

  const check = await verifyPumpLaunch(context.connection, {
    signature,
    mint: plan.mint.publicKey.toBase58(),
    creator: creator.toBase58(),
    expected: config,
    metadataUri: env.PUMP_TOKEN_METADATA_URI,
  });
  if (check.status !== "verified") {
    throw new Error(`Launch NOT verified: ${JSON.stringify(check)}`);
  }
  const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../deployments");
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `${context.network.id}-pump-${check.tokenAddress}.json`);
  await writeFile(file, JSON.stringify({ network: context.network.id, mint: check.tokenAddress, signature, creator: creator.toBase58(), config, details: check.details }, null, 2));
  console.log(`\nVerified Pump.fun coin at ${explorerAddress(context, check.tokenAddress)}`);
  console.log(`Receipt saved to ${file}`);
});
