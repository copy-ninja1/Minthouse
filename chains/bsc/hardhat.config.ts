import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

/**
 * Deployer keys are read through Hardhat configuration variables. Prefer the
 * encrypted keystore (`pnpm --filter @minthouse/chain-bsc exec hardhat keystore set BSC_TESTNET_PRIVATE_KEY`)
 * over plain environment variables. Keys are only resolved when a network that
 * needs them is used, so local development requires none.
 */
export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.34",
        settings: {
          evmVersion: "cancun",
          optimizer: { enabled: true, runs: 200 },
        },
      },
      production: {
        version: "0.8.34",
        settings: {
          evmVersion: "cancun",
          optimizer: { enabled: true, runs: 200 },
        },
      },
    },
  },
  networks: {
    hardhat: {
      type: "edr-simulated",
      chainType: "l1",
      chainId: 31337,
    },
    localhost: {
      type: "http",
      chainType: "l1",
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    bscTestnet: {
      type: "http",
      chainType: "l1",
      chainId: 97,
      url: configVariable("BSC_TESTNET_RPC_URL"),
      accounts: [configVariable("BSC_TESTNET_PRIVATE_KEY")],
    },
    bsc: {
      type: "http",
      chainType: "l1",
      chainId: 56,
      url: configVariable("BSC_MAINNET_RPC_URL"),
      accounts: [configVariable("BSC_MAINNET_PRIVATE_KEY")],
    },
  },
  verify: {
    etherscan: {
      apiKey: configVariable("ETHERSCAN_API_KEY"),
    },
  },
});
