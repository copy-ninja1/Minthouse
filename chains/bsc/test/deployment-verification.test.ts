import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { getAddress, keccak256, type Hash } from "viem";
import { type BscTokenConfig, bscTokenConfigSchema } from "@minthouse/shared";
import {
  LAUNCHPAD_TOKEN_RUNTIME_CODE_HASH,
  buildLaunchpadDeployment,
  classifyEvmError,
  readErc20State,
  reconcileEvmTransaction,
  verifyBscDeployment,
} from "@minthouse/blockchain/bsc";
import { threeAccounts } from "./helpers.js";

const { viem } = await network.create();
const publicClient = await viem.getPublicClient();
const [creator, other, recipient] = threeAccounts(await viem.getWalletClients());

const config: BscTokenConfig = bscTokenConfigSchema.parse({
  mode: "bsc-erc20",
  network: "bsc-local",
  name: "Verified Token",
  symbol: "VER",
  description: "",
  decimals: 18,
  initialSupply: "1000000",
  recipient: recipient.account.address,
  mintingEnabled: true,
});

async function deploy(cfg: BscTokenConfig, from = creator): Promise<Hash> {
  const hash = await from.deployContract(buildLaunchpadDeployment(cfg));
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

describe("shared BSC deployment pipeline", () => {
  it("the committed artifacts match the compiled contract", async () => {
    const token = await viem.deployContract("LaunchpadToken", ["A", "A", 18, 1n, recipient.account.address, true]);
    const code = await publicClient.getCode({ address: token.address });
    assert.ok(code);
    assert.equal(keccak256(code), LAUNCHPAD_TOKEN_RUNTIME_CODE_HASH, "run `pnpm bsc:export` after changing the contract");
  });

  it("verifies a genuine deployment from chain data", async () => {
    const txHash = await deploy(config);
    const check = await verifyBscDeployment(publicClient, { txHash, creator: creator.account.address, expected: config });
    assert.equal(check.status, "verified");
    assert.equal(check.details.initialSupplyBaseUnits, (10n ** 24n).toString());
    assert.equal(check.details.initialRecipient, getAddress(recipient.account.address));

    const state = await readErc20State(publicClient, check.tokenAddress);
    assert.equal(state.isLaunchpadToken, true);
    assert.equal(state.owner, getAddress(creator.account.address));
    assert.equal(state.mintingEnabled, true);
  });

  it("rejects a deployment whose supply differs from the record", async () => {
    const txHash = await deploy(config);
    const check = await verifyBscDeployment(publicClient, {
      txHash,
      creator: creator.account.address,
      expected: { ...config, initialSupply: "999" },
    });
    assert.equal(check.status, "mismatch");
  });

  it("rejects a deployment claimed by a different creator", async () => {
    const txHash = await deploy(config);
    const check = await verifyBscDeployment(publicClient, { txHash, creator: other.account.address, expected: config });
    assert.equal(check.status, "mismatch");
  });

  it("rejects a different minting policy", async () => {
    const txHash = await deploy({ ...config, mintingEnabled: false });
    const check = await verifyBscDeployment(publicClient, { txHash, creator: creator.account.address, expected: config });
    assert.equal(check.status, "mismatch");
  });

  it("rejects a non-template contract", async () => {
    const hash = await creator.sendTransaction({ data: "0x600a600c600039600a6000f3602a60005260206000f3" });
    await publicClient.waitForTransactionReceipt({ hash });
    const check = await verifyBscDeployment(publicClient, { txHash: hash, creator: creator.account.address, expected: config });
    assert.equal(check.status, "mismatch");
  });

  it("reports pending for an unknown hash rather than failure", async () => {
    const check = await verifyBscDeployment(publicClient, {
      txHash: `0x${"ab".repeat(32)}`,
      creator: creator.account.address,
      expected: config,
    });
    assert.equal(check.status, "pending");
  });
});

describe("transaction reconciliation", () => {
  it("finds a mined transaction", async () => {
    const txHash = await deploy(config);
    const state = await reconcileEvmTransaction(publicClient, { hash: txHash, from: creator.account.address });
    assert.equal(state.state, "success");
  });

  it("treats a missing transaction with an unconsumed nonce as unknown, not failed", async () => {
    const nonce = await publicClient.getTransactionCount({ address: creator.account.address });
    const state = await reconcileEvmTransaction(publicClient, {
      hash: `0x${"cd".repeat(32)}`,
      from: creator.account.address,
      nonce,
    });
    assert.equal(state.state, "unknown");
  });

  it("treats a missing transaction whose nonce was consumed as replaced", async () => {
    const nonce = await publicClient.getTransactionCount({ address: creator.account.address });
    await deploy(config);
    const state = await reconcileEvmTransaction(publicClient, {
      hash: `0x${"ef".repeat(32)}`,
      from: creator.account.address,
      nonce,
    });
    assert.equal(state.state, "replaced");
  });
});

describe("error classification", () => {
  it("classifies unauthorized mint reverts", async () => {
    const txHash = await deploy(config);
    const check = await verifyBscDeployment(publicClient, { txHash, creator: creator.account.address, expected: config });
    assert.equal(check.status, "verified");
    const token = await viem.getContractAt("LaunchpadToken", check.tokenAddress);
    try {
      await publicClient.simulateContract({
        address: token.address,
        abi: token.abi,
        functionName: "mint",
        args: [other.account.address, 1n],
        account: other.account,
      });
      assert.fail("expected revert");
    } catch (error) {
      const classified = classifyEvmError(error);
      assert.equal(classified.code, "UNAUTHORIZED");
      assert.equal(classified.revertReason, "OwnableUnauthorizedAccount");
    }
  });

  it("classifies wallet rejection codes", () => {
    assert.equal(classifyEvmError({ code: 4001, message: "User rejected" }).code, "USER_REJECTED");
  });
});
