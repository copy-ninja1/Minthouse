/**
 * Submits LaunchpadToken source for verification on BscScan (Etherscan API v2)
 * and Sourcify, using the constructor arguments saved at deployment.
 * Optional TOKEN_ADDRESS selects a specific recorded deployment.
 */
import hre from "hardhat";
import { verifyContract } from "@nomicfoundation/hardhat-verify/verify";
import { connect } from "./lib/context.js";
import { loadDeployment } from "./lib/deployments.js";
import { runScript } from "@minthouse/config/cli";

await runScript(async () => {
  const context = await connect();
  const record = await loadDeployment(context.networkName, process.env.TOKEN_ADDRESS);
  if (record.chainId !== context.chainId) {
    throw new Error(`Recorded deployment is on chain ${record.chainId}, connected to ${context.chainId}.`);
  }
  const [name, symbol, decimals, supply, recipient, mintingEnabled] = record.constructorArgs;
  const constructorArgs = [name, symbol, decimals, BigInt(supply), recipient, mintingEnabled];

  for (const provider of ["etherscan", "sourcify"] as const) {
    try {
      await verifyContract({ address: record.address, constructorArgs, provider }, hre);
      console.log(`${provider}: verification submitted for ${record.address}`);
    } catch (error) {
      console.error(`${provider}: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
});
