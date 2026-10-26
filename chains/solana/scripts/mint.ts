/** Mints AMOUNT whole tokens of MINT to RECIPIENT. Requires the keypair to hold mint authority. */
import { runScript } from "@minthouse/config/cli";
import { formatTokenAmount, parseTokenAmount } from "@minthouse/shared";
import { mintToInstructions, readMintState, readTokenBalance } from "@minthouse/blockchain/solana";
import { connect, simulateConfirmAndSend } from "./lib/context.js";
import { readEnv, recipientAmountEnv } from "./lib/env.js";

await runScript(async () => {
  const env = readEnv(recipientAmountEnv);
  const context = await connect();
  const authority = context.signer.publicKey;
  const before = await readMintState(context.connection, env.MINT.toBase58());
  if (before.mintAuthority === null) {
    throw new Error("Mint authority has been revoked; nobody can mint this token.");
  }
  if (before.mintAuthority !== authority.toBase58()) {
    throw new Error(`Mint authority is ${before.mintAuthority}, not the configured keypair ${authority.toBase58()}.`);
  }
  const amount = parseTokenAmount(env.AMOUNT, before.decimals);
  const ref = { mint: env.MINT, decimals: before.decimals, tokenProgram: before.tokenProgramId };

  await simulateConfirmAndSend(context, {
    title: `Mint ${before.metadata?.symbol ?? "tokens"}`,
    instructions: mintToInstructions(ref, { authority, payer: authority, recipient: env.RECIPIENT, amount }),
    summary: {
      Mint: env.MINT.toBase58(),
      Recipient: env.RECIPIENT.toBase58(),
      Amount: `${formatTokenAmount(amount, before.decimals)} (${amount} base units)`,
      "Supply after": formatTokenAmount(before.supply + amount, before.decimals),
    },
  });

  const after = await readMintState(context.connection, env.MINT.toBase58());
  if (after.supply !== before.supply + amount) {
    throw new Error(`Supply is ${after.supply}, expected ${before.supply + amount}.`);
  }
  const balance = await readTokenBalance(context.connection, { ...ref, owner: env.RECIPIENT });
  console.log(`Verified on-chain: supply ${formatTokenAmount(after.supply, after.decimals)}, recipient balance ${formatTokenAmount(balance, after.decimals)}`);
});
