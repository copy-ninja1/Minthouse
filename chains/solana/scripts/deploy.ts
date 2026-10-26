/**
 * Creates a standard SPL token with Metaplex metadata in one atomic transaction.
 * SOLANA_INITIAL_SUPPLY is in WHOLE tokens; SOLANA_TOKEN_DECIMALS is independent
 * of any BSC setting and limited to 9 by the SPL Token program.
 *
 *   pnpm solana:deploy:local | solana:deploy:devnet | solana:deploy:mainnet
 *   (other scripts take --cluster=<localnet|devnet|mainnet-beta> or SOLANA_CLUSTER)
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { solanaDeployEnvSchema } from "@minthouse/config";
import { parseCliEnv, runScript } from "@minthouse/config/cli";
import { formatTokenAmount, splTokenConfigSchema } from "@minthouse/shared";
import { planCreateSplToken, verifySplDeployment } from "@minthouse/blockchain/solana";
import { connect, explorerAddress, simulateConfirmAndSend } from "./lib/context.js";

await runScript(async () => {
  const env = parseCliEnv(solanaDeployEnvSchema);
  const context = await connect();
  const creator = context.signer.publicKey;

  const config = splTokenConfigSchema.parse({
    mode: "solana-spl",
    network: context.network.id,
    name: env.SOLANA_TOKEN_NAME,
    symbol: env.SOLANA_TOKEN_SYMBOL,
    description: env.SOLANA_TOKEN_DESCRIPTION,
    website: env.SOLANA_TOKEN_WEBSITE,
    twitter: env.SOLANA_TOKEN_TWITTER,
    telegram: env.SOLANA_TOKEN_TELEGRAM,
    decimals: env.SOLANA_TOKEN_DECIMALS,
    initialSupply: env.SOLANA_INITIAL_SUPPLY,
    recipient: env.SOLANA_INITIAL_RECIPIENT ?? creator.toBase58(),
    mintAuthority: env.SOLANA_MINT_AUTHORITY,
    metadataMutable: env.SOLANA_METADATA_MUTABLE,
  });
  const plan = await planCreateSplToken(context.connection, { creator, config, metadataUri: env.SOLANA_TOKEN_METADATA_URI });

  const signature = await simulateConfirmAndSend(context, {
    title: `Create SPL token ${config.symbol}`,
    instructions: plan.instructions,
    extraSigners: [plan.mint],
    summary: {
      Mint: `${plan.mint.publicKey.toBase58()} (new)`,
      Name: config.name,
      Symbol: config.symbol,
      Decimals: String(config.decimals),
      "Initial supply": `${formatTokenAmount(plan.initialSupply, config.decimals)} (${plan.initialSupply} base units)`,
      "Initial recipient": config.recipient + (config.recipient === creator.toBase58() ? " (creator)" : " (NOT the creator)"),
      "Recipient token acct": plan.recipientTokenAccount?.toBase58() ?? "none (zero supply)",
      "Mint authority": config.mintAuthority === "revoke" ? "REVOKED at creation — supply fixed forever" : `${creator.toBase58()} (creator)`,
      "Freeze authority": "none",
      "Metadata URI": env.SOLANA_TOKEN_METADATA_URI,
      "Metadata mutable": config.metadataMutable ? "yes (creator is update authority)" : "no",
    },
  });

  const check = await verifySplDeployment(context.connection, {
    signature,
    mint: plan.mint.publicKey.toBase58(),
    creator: creator.toBase58(),
    expected: config,
    metadataUri: env.SOLANA_TOKEN_METADATA_URI,
  });
  if (check.status !== "verified") {
    throw new Error(`Deployment NOT verified: ${JSON.stringify(check)}`);
  }

  const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../deployments");
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `${context.network.id}-${check.tokenAddress}.json`);
  await writeFile(
    file,
    JSON.stringify(
      { network: context.network.id, mint: check.tokenAddress, signature, creator: creator.toBase58(), config, details: check.details, deployedAt: new Date().toISOString() },
      null,
      2,
    ),
  );

  console.log(`\nVerified SPL token at ${explorerAddress(context, check.tokenAddress)}`);
  for (const [key, value] of Object.entries(check.details)) {
    console.log(`  ${key.padEnd(22)} ${value}`);
  }
  console.log(`\nReceipt saved to ${file}`);
});
