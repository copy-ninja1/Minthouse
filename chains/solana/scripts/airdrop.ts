/** Requests test SOL for the configured keypair on devnet or a local validator. Refuses on mainnet. */
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { runScript } from "@minthouse/config/cli";
import { connect, formatSol } from "./lib/context.js";

await runScript(async () => {
  const context = await connect();
  if (context.network.isMainnet) {
    throw new Error("Airdrops do not exist on mainnet.");
  }
  const signature = await context.connection.requestAirdrop(context.signer.publicKey, LAMPORTS_PER_SOL);
  const latest = await context.connection.getLatestBlockhash();
  await context.connection.confirmTransaction({ signature, ...latest }, "confirmed");
  const balance = await context.connection.getBalance(context.signer.publicKey);
  console.log(`${context.signer.publicKey.toBase58()} balance: ${formatSol(BigInt(balance))} SOL`);
});
