/**
 * Buys or sells a Pump.fun coin on its bonding curve. Always an explicit
 * operator action; amounts are bounded by SLIPPAGE_BPS on-chain.
 *
 *   pump:buy  MINT AMOUNT=<SOL to spend>    [SLIPPAGE_BPS=100]
 *   pump:sell MINT AMOUNT=<tokens to sell>  [SLIPPAGE_BPS=100]
 */
import type { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { runScript } from "@minthouse/config/cli";
import { PUMPFUN_TOKEN_DECIMALS, SOL_DECIMALS, formatTokenAmount, parseTokenAmount, slippageBpsField } from "@minthouse/shared";
import { classifyPumpError, fetchPumpProtocol, planPumpBuy, planPumpSell } from "@minthouse/blockchain/pump";
import { readTokenBalance } from "@minthouse/blockchain/solana";
import { connect, formatSol, simulateConfirmAndSend } from "./lib/context.js";
import { amountEnv, readEnv } from "./lib/env.js";

const side = process.argv.includes("--sell") ? "sell" : process.argv.includes("--buy") ? "buy" : null;

await runScript(async () => {
  if (!side) {
    throw new Error("Pass --buy or --sell.");
  }
  const env = readEnv(amountEnv.extend({ SLIPPAGE_BPS: z.coerce.number().optional().pipe(slippageBpsField) }));
  const slippageBps = env.SLIPPAGE_BPS;
  const context = await connect();
  const user = context.signer.publicKey;
  const protocol = await fetchPumpProtocol(context.connection);

  let tokenProgram: PublicKey;
  try {
    if (side === "buy") {
      const plan = await planPumpBuy(context.connection, protocol, { mint: env.MINT, user, lamports: parseTokenAmount(env.AMOUNT, SOL_DECIMALS), slippageBps });
      tokenProgram = plan.context.tokenProgramId;
      await simulateConfirmAndSend(context, {
        title: "Buy on Pump.fun curve",
        instructions: plan.instructions,
        summary: {
          Mint: env.MINT.toBase58(),
          Spend: `${formatSol(plan.quote.lamportsIn)} SOL`,
          Receive: `${formatTokenAmount(plan.quote.tokensOut, PUMPFUN_TOKEN_DECIMALS)} tokens (exact)`,
          "Maximum cost": `${formatSol(plan.quote.maxCostLamports)} SOL (${slippageBps / 100}% slippage)`,
        },
      });
    } else {
      const amount = parseTokenAmount(env.AMOUNT, PUMPFUN_TOKEN_DECIMALS);
      const plan = await planPumpSell(context.connection, protocol, { mint: env.MINT, user, tokens: amount, slippageBps });
      tokenProgram = plan.context.tokenProgramId;
      const held = await readTokenBalance(context.connection, { mint: env.MINT, owner: user, tokenProgram: plan.context.tokenProgramId });
      if (held < amount) {
        throw new Error(`Balance ${formatTokenAmount(held, PUMPFUN_TOKEN_DECIMALS)} is below ${env.AMOUNT}.`);
      }
      await simulateConfirmAndSend(context, {
        title: "Sell on Pump.fun curve",
        instructions: plan.instructions,
        summary: {
          Mint: env.MINT.toBase58(),
          Sell: `${formatTokenAmount(amount, PUMPFUN_TOKEN_DECIMALS)} tokens`,
          "Expected proceeds": `${formatSol(plan.quote.lamportsOut)} SOL (after protocol and creator fees)`,
          "Minimum proceeds": `${formatSol(plan.quote.minLamportsOut)} SOL (${slippageBps / 100}% slippage)`,
        },
      });
    }
  } catch (error) {
    const classified = classifyPumpError(error);
    throw classified.code === "UNKNOWN" ? error : new Error(classified.message, { cause: error });
  }
  const balance = await readTokenBalance(context.connection, { mint: env.MINT, owner: user, tokenProgram });
  console.log(`Token balance now ${formatTokenAmount(balance, PUMPFUN_TOKEN_DECIMALS)}`);
});
