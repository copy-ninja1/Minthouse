import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { getAddress, keccak256, zeroAddress } from "viem";
import { wholeTokensToBaseUnits } from "@minthouse/shared";
import { threeAccounts } from "./helpers.js";

const { viem, networkHelpers } = await network.create();
const publicClient = await viem.getPublicClient();
const [deployer, alice, bob] = threeAccounts(await viem.getWalletClients());

const INITIAL_SUPPLY = wholeTokensToBaseUnits("1000000", 18);

async function deployMintable() {
  const token = await viem.deployContract("LaunchpadToken", ["My Token", "MTK", 18, INITIAL_SUPPLY, alice.account.address, true]);
  return { token };
}

async function deployFixed() {
  const token = await viem.deployContract("LaunchpadToken", ["Fixed", "FIX", 9, 5_000n, bob.account.address, false]);
  return { token };
}

describe("LaunchpadToken: deployment", () => {
  it("sets metadata, decimals and owner", async () => {
    const { token } = await networkHelpers.loadFixture(deployMintable);
    assert.equal(await token.read.name(), "My Token");
    assert.equal(await token.read.symbol(), "MTK");
    assert.equal(await token.read.decimals(), 18);
    assert.equal(await token.read.owner(), getAddress(deployer.account.address));
    assert.equal(await token.read.mintingEnabled(), true);
  });

  it("mints the whole initial supply to the initial recipient, not the deployer", async () => {
    const { token } = await networkHelpers.loadFixture(deployMintable);
    assert.equal(await token.read.totalSupply(), INITIAL_SUPPLY);
    assert.equal(await token.read.balanceOf([alice.account.address]), INITIAL_SUPPLY);
    assert.equal(await token.read.balanceOf([deployer.account.address]), 0n);
  });

  it("supports the documented 10^15 whole-token supply at 18 decimals", async () => {
    const raw = wholeTokensToBaseUnits("1000000000000000", 18);
    const token = await viem.deployContract("LaunchpadToken", ["Big", "BIG", 18, raw, alice.account.address, false]);
    assert.equal(await token.read.totalSupply(), 10n ** 33n);
  });

  it("supports custom decimals", async () => {
    const { token } = await networkHelpers.loadFixture(deployFixed);
    assert.equal(await token.read.decimals(), 9);
    assert.equal(await token.read.mintingEnabled(), false);
  });

  it("emits MintingDisabled when deployed with a fixed supply", async () => {
    const { token } = await networkHelpers.loadFixture(deployFixed);
    const events = await publicClient.getContractEvents({
      address: token.address,
      abi: token.abi,
      eventName: "MintingDisabled",
      fromBlock: 0n,
      strict: true,
    });
    assert.equal(events.length, 1);
    assert.equal(events[0]?.args.account, getAddress(deployer.account.address));
  });

  it("rejects decimals above 18", async () => {
    await assert.rejects(
      viem.deployContract("LaunchpadToken", ["X", "X", 19, 1n, alice.account.address, true]),
      /InvalidDecimals/,
    );
  });

  it("rejects empty name or symbol", async () => {
    await assert.rejects(viem.deployContract("LaunchpadToken", ["", "X", 18, 1n, alice.account.address, true]), /EmptyNameOrSymbol/);
    await assert.rejects(viem.deployContract("LaunchpadToken", ["X", "", 18, 1n, alice.account.address, true]), /EmptyNameOrSymbol/);
  });

  it("rejects a fixed supply of zero", async () => {
    await assert.rejects(
      viem.deployContract("LaunchpadToken", ["X", "X", 18, 0n, alice.account.address, false]),
      /FixedSupplyRequiresTokens/,
    );
  });

  it("rejects minting the initial supply to the zero address", async () => {
    await assert.rejects(viem.deployContract("LaunchpadToken", ["X", "X", 18, 1n, zeroAddress, true]), /ERC20InvalidReceiver/);
  });

  it("allows zero initial supply when minting stays enabled", async () => {
    const token = await viem.deployContract("LaunchpadToken", ["Zero", "ZRO", 18, 0n, zeroAddress, true]);
    assert.equal(await token.read.totalSupply(), 0n);
  });

  it("produces identical runtime bytecode for every deployment", async () => {
    const { token: a } = await networkHelpers.loadFixture(deployMintable);
    const b = await viem.deployContract("LaunchpadToken", ["Other", "OTH", 6, 7n, bob.account.address, false]);
    const codeA = await publicClient.getCode({ address: a.address });
    const codeB = await publicClient.getCode({ address: b.address });
    assert.ok(codeA && codeB);
    assert.equal(keccak256(codeA), keccak256(codeB));
  });
});

describe("LaunchpadToken: minting", () => {
  it("lets the owner mint and updates supply", async () => {
    const { token } = await networkHelpers.loadFixture(deployMintable);
    await viem.assertions.emitWithArgs(token.write.mint([bob.account.address, 42n]), token, "Transfer", [
      zeroAddress,
      getAddress(bob.account.address),
      42n,
    ]);
    assert.equal(await token.read.totalSupply(), INITIAL_SUPPLY + 42n);
    assert.equal(await token.read.balanceOf([bob.account.address]), 42n);
  });

  it("rejects minting by non-owners", async () => {
    const { token } = await networkHelpers.loadFixture(deployMintable);
    await viem.assertions.revertWithCustomErrorWithArgs(
      token.write.mint([alice.account.address, 1n], { account: alice.account }),
      token,
      "OwnableUnauthorizedAccount",
      [getAddress(alice.account.address)],
    );
  });

  it("rejects minting to the zero address", async () => {
    const { token } = await networkHelpers.loadFixture(deployMintable);
    await viem.assertions.revertWithCustomError(token.write.mint([zeroAddress, 1n]), token, "ERC20InvalidReceiver");
  });

  it("permanently disables minting", async () => {
    const { token } = await networkHelpers.loadFixture(deployMintable);
    await viem.assertions.emitWithArgs(token.write.disableMinting(), token, "MintingDisabled", [
      getAddress(deployer.account.address),
    ]);
    assert.equal(await token.read.mintingEnabled(), false);
    await viem.assertions.revertWithCustomError(token.write.mint([bob.account.address, 1n]), token, "MintingIsDisabled");
    await viem.assertions.revertWithCustomError(token.write.disableMinting(), token, "MintingIsDisabled");
  });

  it("rejects disabling minting by non-owners", async () => {
    const { token } = await networkHelpers.loadFixture(deployMintable);
    await viem.assertions.revertWithCustomError(
      token.write.disableMinting({ account: bob.account }),
      token,
      "OwnableUnauthorizedAccount",
    );
  });

  it("never allows minting on a fixed-supply token", async () => {
    const { token } = await networkHelpers.loadFixture(deployFixed);
    await viem.assertions.revertWithCustomError(token.write.mint([bob.account.address, 1n]), token, "MintingIsDisabled");
  });
});

describe("LaunchpadToken: transfers, approvals, burning", () => {
  it("transfers between holders", async () => {
    const { token } = await networkHelpers.loadFixture(deployMintable);
    await token.write.transfer([bob.account.address, 10n], { account: alice.account });
    assert.equal(await token.read.balanceOf([bob.account.address]), 10n);
    assert.equal(await token.read.balanceOf([alice.account.address]), INITIAL_SUPPLY - 10n);
  });

  it("rejects transfers above balance", async () => {
    const { token } = await networkHelpers.loadFixture(deployMintable);
    await viem.assertions.revertWithCustomError(
      token.write.transfer([alice.account.address, 1n], { account: bob.account }),
      token,
      "ERC20InsufficientBalance",
    );
  });

  it("handles approvals, transferFrom and approval revocation", async () => {
    const { token } = await networkHelpers.loadFixture(deployMintable);
    await token.write.approve([bob.account.address, 100n], { account: alice.account });
    assert.equal(await token.read.allowance([alice.account.address, bob.account.address]), 100n);
    await token.write.transferFrom([alice.account.address, bob.account.address, 60n], { account: bob.account });
    assert.equal(await token.read.allowance([alice.account.address, bob.account.address]), 40n);
    await token.write.approve([bob.account.address, 0n], { account: alice.account });
    await viem.assertions.revertWithCustomError(
      token.write.transferFrom([alice.account.address, bob.account.address, 1n], { account: bob.account }),
      token,
      "ERC20InsufficientAllowance",
    );
  });

  it("lets holders burn their own tokens and reduces supply", async () => {
    const { token } = await networkHelpers.loadFixture(deployMintable);
    await token.write.burn([1_000n], { account: alice.account });
    assert.equal(await token.read.totalSupply(), INITIAL_SUPPLY - 1_000n);
  });

  it("burnFrom requires allowance", async () => {
    const { token } = await networkHelpers.loadFixture(deployMintable);
    await viem.assertions.revertWithCustomError(
      token.write.burnFrom([alice.account.address, 1n], { account: bob.account }),
      token,
      "ERC20InsufficientAllowance",
    );
  });

  it("the owner cannot move or burn other holders' tokens", async () => {
    const { token } = await networkHelpers.loadFixture(deployMintable);
    await viem.assertions.revertWithCustomError(
      token.write.transferFrom([alice.account.address, deployer.account.address, 1n]),
      token,
      "ERC20InsufficientAllowance",
    );
    await viem.assertions.revertWithCustomError(
      token.write.burnFrom([alice.account.address, 1n]),
      token,
      "ERC20InsufficientAllowance",
    );
  });
});

describe("LaunchpadToken: ownership", () => {
  it("transfers ownership in two steps", async () => {
    const { token } = await networkHelpers.loadFixture(deployMintable);
    await token.write.transferOwnership([bob.account.address]);
    assert.equal(await token.read.owner(), getAddress(deployer.account.address));
    assert.equal(await token.read.pendingOwner(), getAddress(bob.account.address));

    await viem.assertions.revertWithCustomError(
      token.write.acceptOwnership({ account: alice.account }),
      token,
      "OwnableUnauthorizedAccount",
    );
    await token.write.acceptOwnership({ account: bob.account });
    assert.equal(await token.read.owner(), getAddress(bob.account.address));

    await viem.assertions.revertWithCustomError(token.write.mint([bob.account.address, 1n]), token, "OwnableUnauthorizedAccount");
    await token.write.mint([bob.account.address, 1n], { account: bob.account });
  });

  it("renouncing ownership leaves nobody able to mint", async () => {
    const { token } = await networkHelpers.loadFixture(deployMintable);
    await token.write.renounceOwnership();
    assert.equal(await token.read.owner(), zeroAddress);
    await viem.assertions.revertWithCustomError(token.write.mint([bob.account.address, 1n]), token, "OwnableUnauthorizedAccount");
  });

  it("renouncing clears a pending ownership transfer", async () => {
    const { token } = await networkHelpers.loadFixture(deployMintable);
    await token.write.transferOwnership([bob.account.address]);
    await token.write.renounceOwnership();
    assert.equal(await token.read.pendingOwner(), zeroAddress);
    await viem.assertions.revertWithCustomError(
      token.write.acceptOwnership({ account: bob.account }),
      token,
      "OwnableUnauthorizedAccount",
    );
  });
});
