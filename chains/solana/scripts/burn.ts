/** Burns AMOUNT whole tokens of MINT from the keypair's own token account. */
import { runScript } from "@minthouse/config/cli";
import { formatTokenAmount, parseTokenAmount } from "@minthouse/shared";
import { burnInstructions, readMintState, readTokenBalance } from "@minthouse/blockchain/solana";
import { connect, simulateConfirmAndSend } from "./lib/context.js";
import { amountEnv, readEnv } from "./lib/env.js";

await runScript(async () => {
  const env = readEnv(amountEnv);
  const context = await connect();
  const owner = context.signer.publicKey;
  const before = await readMintState(context.connection, env.MINT.toBase58());
  const ref = { mint: env.MINT, decimals: before.decimals, tokenProgram: before.tokenProgramId };
  const amount = parseTokenAmount(env.AMOUNT, before.decimals);
  const balance = await readTokenBalance(context.connection, { ...ref, owner });
  if (balance < amount) {
    throw new Error(`Balance ${formatTokenAmount(balance, before.decimals)} is below ${env.AMOUNT}.`);
  }
  const symbol = before.metadata?.symbol ?? "tokens";

  await simulateConfirmAndSend(context, {
    title: `Burn ${symbol}`,
    instructions: burnInstructions(ref, { owner, amount }),
    summary: { Mint: env.MINT.toBase58(), Amount: formatTokenAmount(amount, before.decimals), "Supply after": formatTokenAmount(before.supply - amount, before.decimals) },
    irreversible: { phrase: `burn ${env.AMOUNT} ${symbol}`, warning: "Burned tokens are destroyed permanently." },
  });

  const after = await readMintState(context.connection, env.MINT.toBase58());
  if (after.supply !== before.supply - amount) {
    throw new Error(`Supply is ${after.supply}, expected ${before.supply - amount}.`);
  }
  console.log(`Verified on-chain: supply ${formatTokenAmount(after.supply, after.decimals)}`);
});
