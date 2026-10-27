import { describe, expect, it } from "vitest";
import { tokenConfigSchema } from "./token-config.js";

const EVM_RECIPIENT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const SOLANA_RECIPIENT = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

const baseBsc = {
  mode: "bsc-erc20",
  network: "bsc-testnet",
  name: "My Token",
  symbol: "MTK",
  description: "",
  decimals: 18,
  initialSupply: "1000000",
  recipient: EVM_RECIPIENT,
  mintingEnabled: true,
  liquidityNative: "0.1",
  liquidityTokens: "1000000",
} as const;

const baseSpl = {
  mode: "solana-spl",
  network: "solana-devnet",
  name: "My Token",
  symbol: "MTK",
  description: "A test token",
  decimals: 9,
  initialSupply: "1000000",
  recipient: SOLANA_RECIPIENT,
  mintAuthority: "retain",
  metadataMutable: true,
  liquidityNative: "0.1",
  liquidityTokens: "1000000",
  initialBuySol: "0.01",
  slippageBps: 100,
} as const;

describe("tokenConfigSchema", () => {
  it("accepts a valid BSC configuration", () => {
    expect(tokenConfigSchema.safeParse(baseBsc).success).toBe(true);
  });

  it("accepts 18 decimals when the supply fits in u64", () => {
    expect(
      tokenConfigSchema.safeParse({
        ...baseSpl,
        decimals: 18,
        initialSupply: "18",
        liquidityTokens: "18",
      }).success,
    ).toBe(true);
  });

  it("rejects decimals above 18 on a standard SPL token", () => {
    const result = tokenConfigSchema.safeParse({ ...baseSpl, decimals: 19 });
    expect(result.success).toBe(false);
  });

  it("rejects an SPL supply that overflows u64 at 18 decimals", () => {
    const result = tokenConfigSchema.safeParse({
      ...baseSpl,
      decimals: 18,
      initialSupply: "19",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("18 whole tokens");
  });

  it("rejects an SPL supply that overflows u64", () => {
    const result = tokenConfigSchema.safeParse({
      ...baseSpl,
      initialSupply: "1000000000000000",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("at most 4 decimals");
  });

  it("accepts 10^15 whole tokens at 4 decimals", () => {
    expect(
      tokenConfigSchema.safeParse({
        ...baseSpl,
        decimals: 4,
        initialSupply: "1000000000000000",
      }).success,
    ).toBe(true);
  });

  it("does not throw when the supply field itself is malformed", () => {
    const result = tokenConfigSchema.safeParse({
      ...baseSpl,
      initialSupply: "1.5",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a BSC network for an SPL token", () => {
    expect(
      tokenConfigSchema.safeParse({ ...baseSpl, network: "bsc-testnet" })
        .success,
    ).toBe(false);
  });

  it("rejects a Solana recipient on BSC and a bad checksum", () => {
    expect(
      tokenConfigSchema.safeParse({ ...baseBsc, recipient: SOLANA_RECIPIENT })
        .success,
    ).toBe(false);
    expect(
      tokenConfigSchema.safeParse({
        ...baseBsc,
        recipient: "0x70997970C51812dc3A010C7d01b50e0d17dc79c8",
      }).success,
    ).toBe(false);
  });

  it("rejects a zero-supply fixed token", () => {
    expect(
      tokenConfigSchema.safeParse({
        ...baseBsc,
        initialSupply: "0",
        mintingEnabled: false,
      }).success,
    ).toBe(false);
    expect(
      tokenConfigSchema.safeParse({
        ...baseSpl,
        initialSupply: "0",
        mintAuthority: "revoke",
      }).success,
    ).toBe(false);
  });

  it("enforces Metaplex byte limits on Solana names", () => {
    expect(
      tokenConfigSchema.safeParse({ ...baseSpl, name: "x".repeat(33) }).success,
    ).toBe(false);
    expect(
      tokenConfigSchema.safeParse({ ...baseSpl, name: "🚀".repeat(9) }).success,
    ).toBe(false);
  });

  it("only accepts https social links on the expected hosts", () => {
    expect(
      tokenConfigSchema.safeParse({
        ...baseSpl,
        twitter: "https://x.com/minthouse",
      }).success,
    ).toBe(true);
    expect(
      tokenConfigSchema.safeParse({
        ...baseSpl,
        twitter: "https://evil.example/x.com",
      }).success,
    ).toBe(false);
    expect(
      tokenConfigSchema.safeParse({
        ...baseSpl,
        website: "javascript:alert(1)",
      }).success,
    ).toBe(false);
    expect(
      tokenConfigSchema.safeParse({
        ...baseSpl,
        website: "http://insecure.example",
      }).success,
    ).toBe(false);
  });

  it("treats empty optional links as absent", () => {
    const parsed = tokenConfigSchema.parse({ ...baseSpl, website: "" });
    expect(parsed.website).toBeUndefined();
  });

  it("offers no supply or decimals fields for Pump.fun", () => {
    const parsed = tokenConfigSchema.parse({
      mode: "pumpfun",
      network: "solana-devnet",
      name: "Pump",
      symbol: "PMP",
      description: "",
      initialSupply: "999",
      decimals: 9,
    });
    expect(parsed).not.toHaveProperty("initialSupply");
    expect(parsed).not.toHaveProperty("decimals");
  });

  it("rejects Pump.fun on BSC networks", () => {
    expect(
      tokenConfigSchema.safeParse({
        mode: "pumpfun",
        network: "bsc-mainnet",
        name: "P",
        symbol: "P",
        description: "",
      }).success,
    ).toBe(false);
  });

  it("requires DEX liquidity on non-local networks", () => {
    const result = tokenConfigSchema.safeParse({
      ...baseSpl,
      liquidityNative: "0",
      liquidityTokens: "0",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path[0] === "liquidityNative")).toBe(
      true,
    );
  });

  it("allows zero liquidity on local networks", () => {
    expect(
      tokenConfigSchema.safeParse({
        ...baseSpl,
        network: "solana-local",
        liquidityNative: "0",
        liquidityTokens: "0",
        initialBuySol: "0",
      }).success,
    ).toBe(true);
  });

  it("requires an initial buy when seeding a Raydium pool on mainnet/devnet", () => {
    const result = tokenConfigSchema.safeParse({
      ...baseSpl,
      initialBuySol: "0",
    });
    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) => issue.path[0] === "initialBuySol"),
    ).toBe(true);
  });
});
