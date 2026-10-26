/**
 * Deploys a LaunchpadToken using TOKEN_* environment variables.
 * TOKEN_INITIAL_SUPPLY is in WHOLE tokens and is scaled by TOKEN_DECIMALS here.
 *
 *   pnpm bsc:deploy:local | bsc:deploy:testnet | bsc:deploy:mainnet
 */
import { encodeDeployData, formatEther } from "viem";
import { bscDeployEnvSchema } from "@minthouse/config";
import { parseCliEnv, requireTypedConfirmation } from "@minthouse/config/cli";
import { bscTokenConfigSchema, formatTokenAmount, sameAddress, wholeTokensToBaseUnits } from "@minthouse/shared";
import { buildLaunchpadDeployment, verifyBscDeployment } from "@minthouse/blockchain/bsc";
import { connect, explorerAddress, explorerTx, requireWallet } from "./lib/context.js";
import { saveDeployment } from "./lib/deployments.js";
import { runScript } from "@minthouse/config/cli";

await runScript(async () => {
  const env = parseCliEnv(bscDeployEnvSchema);
  const context = await connect();
  const { wallet, signer } = requireWallet(context);

  const config = bscTokenConfigSchema.parse({
    mode: "bsc-erc20",
    network: context.network.id,
    name: env.TOKEN_NAME,
    symbol: env.TOKEN_SYMBOL,
    description: "",
    decimals: env.TOKEN_DECIMALS,
    initialSupply: env.TOKEN_INITIAL_SUPPLY,
    recipient: env.TOKEN_INITIAL_RECIPIENT ?? signer,
    mintingEnabled: env.TOKEN_MINTING_ENABLED,
  });
  const deployment = buildLaunchpadDeployment(config);
  const rawSupply = wholeTokensToBaseUnits(config.initialSupply, config.decimals);

  const [gas, gasPrice, balance] = await Promise.all([
    context.publicClient.estimateGas({ account: wallet.account, data: encodeDeployData(deployment) }),
    context.publicClient.getGasPrice(),
    context.publicClient.getBalance({ address: signer }),
  ]);
  const estimatedFee = gas * gasPrice;
  if (balance < estimatedFee) {
    throw new Error(
      `Deployer balance ${formatEther(balance)} ${context.network.nativeSymbol} is below the estimated fee ${formatEther(estimatedFee)}.`,
    );
  }

  const summary = {
    Network: `${context.network.label} (chain ${context.chainId})`,
    Deployer: signer,
    Name: config.name,
    Symbol: config.symbol,
    Decimals: String(config.decimals),
    "Initial supply": `${formatTokenAmount(rawSupply, config.decimals)} ${config.symbol} (${rawSupply} base units)`,
    "Initial recipient": config.recipient + (sameAddress("bsc", config.recipient, signer) ? " (deployer)" : " (NOT the deployer)"),
    Minting: config.mintingEnabled ? "owner can mint more until disabled" : "permanently disabled (fixed supply)",
    "Estimated network fee": `${formatEther(estimatedFee)} ${context.network.nativeSymbol} (estimate, not final)`,
  };

  if (context.isMainnet) {
    await requireTypedConfirmation({
      title: "Deploy LaunchpadToken to BNB Smart Chain MAINNET",
      summary,
      phrase: `deploy ${config.symbol} on ${context.network.id}`,
      warning: "This spends real BNB and creates a permanent public contract.",
    });
  } else {
    console.log("\nDeploying LaunchpadToken");
    for (const [key, value] of Object.entries(summary)) {
      console.log(`  ${key.padEnd(22)} ${value}`);
    }
  }

  const txHash = await wallet.deployContract(deployment);
  console.log(`\nSubmitted: ${explorerTx(context, txHash)}`);
  const receipt = await context.publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: context.confirmations });

  const check = await verifyBscDeployment(context.publicClient, { txHash, creator: signer, expected: config });
  if (check.status !== "verified") {
    console.error(`Deployment NOT verified: ${JSON.stringify(check, (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value))}`);
    throw new Error("Deployment verification failed.");
  }

  const file = await saveDeployment({
    network: context.networkName,
    chainId: context.chainId,
    address: check.tokenAddress,
    txHash,
    deployer: signer,
    blockNumber: receipt.blockNumber.toString(),
    constructorArgs: [config.name, config.symbol, config.decimals, rawSupply.toString(), config.recipient, config.mintingEnabled],
    deployedAt: new Date().toISOString(),
  });

  console.log(`\nVerified deployment at ${explorerAddress(context, check.tokenAddress)}`);
  for (const [key, value] of Object.entries(check.details)) {
    console.log(`  ${key.padEnd(22)} ${value}`);
  }
  console.log(`\nReceipt saved to ${file}`);
});
