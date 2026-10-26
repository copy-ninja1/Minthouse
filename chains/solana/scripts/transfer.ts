/** Transfers AMOUNT whole tokens of MINT from the keypair to RECIPIENT, creating their token account if needed. */
import { runScript } from "@minthouse/config/cli";
import { formatTokenAmount, parseTokenAmount } from "@minthouse/shared";
import { readMintState, readTokenBalance, transferInstructions } from "@minthouse/blockchain/solana";
import { connect, simulateConfirmAndSend } from "./lib/context.js";
import { readEnv, recipientAmountEnv } from "./lib/env.js";

await runScript(async () => {
  const env = readEnv(recipientAmountEnv);
  const context = await connect();
  const owner = context.signer.publicKey;
  const state = await readMintState(context.connection, env.MINT.toBase58());
  const ref = { mint: env.MINT, decimals: state.decimals, tokenProgram: state.tokenProgramId };
  const amount = parseTokenAmount(env.AMOUNT, state.decimals);
  const balance = await readTokenBalance(context.connection, { ...ref, owner });
  if (balance < amount) {
    throw new Error(`Balance ${formatTokenAmount(balance, state.decimals)} is below ${env.AMOUNT}.`);
  }
  const recipientBefore = await readTokenBalance(context.connection, { ...ref, owner: env.RECIPIENT });

  await simulateConfirmAndSend(context, {
    title: `Transfer ${state.metadata?.symbol ?? "tokens"}`,
    instructions: transferInstructions(ref, { owner, recipient: env.RECIPIENT, amount }),
    summary: { Mint: env.MINT.toBase58(), Recipient: env.RECIPIENT.toBase58(), Amount: formatTokenAmount(amount, state.decimals) },
  });

  const recipientAfter = await readTokenBalance(context.connection, { ...ref, owner: env.RECIPIENT });
  if (!env.RECIPIENT.equals(owner) && recipientAfter !== recipientBefore + amount) {
    throw new Error("Recipient balance did not increase by the transferred amount.");
  }
  console.log(`Verified on-chain: recipient balance ${formatTokenAmount(recipientAfter, state.decimals)}`);
});
