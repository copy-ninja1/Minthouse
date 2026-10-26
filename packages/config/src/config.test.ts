import { describe, expect, it } from "vitest";
import { apiEnvSchema, bscDeployEnvSchema, findLeakedClientSecrets, solanaDeployEnvSchema, webEnvSchema } from "./index.js";

const solanaBase = {
  SOLANA_TOKEN_NAME: "My Token",
  SOLANA_TOKEN_SYMBOL: "MTK",
  SOLANA_TOKEN_METADATA_URI: "https://ipfs.io/ipfs/bafkreigh2akiscaildc",
};

describe("bscDeployEnvSchema", () => {
  it("accepts the documented example and defaults to 18 decimals", () => {
    const env = bscDeployEnvSchema.parse({
      TOKEN_NAME: "My Token",
      TOKEN_SYMBOL: "MTK",
      TOKEN_INITIAL_SUPPLY: "1000000000000000",
    });
    expect(env.TOKEN_DECIMALS).toBe(18);
    expect(env.TOKEN_MINTING_ENABLED).toBe(true);
  });
});

describe("solanaDeployEnvSchema", () => {
  it("rejects the documented 10^15 supply at 9 decimals with an explanation", () => {
    const result = solanaDeployEnvSchema.safeParse({ ...solanaBase, SOLANA_INITIAL_SUPPLY: "1000000000000000" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("18446744073 whole tokens");
  });

  it("never inherits the BSC decimals setting", () => {
    const env = solanaDeployEnvSchema.parse({ ...solanaBase, SOLANA_INITIAL_SUPPLY: "1000000", TOKEN_DECIMALS: "18" });
    expect(env.SOLANA_TOKEN_DECIMALS).toBe(9);
  });

  it("rejects 18 decimals for a standard SPL token", () => {
    const result = solanaDeployEnvSchema.safeParse({ ...solanaBase, SOLANA_INITIAL_SUPPLY: "1", SOLANA_TOKEN_DECIMALS: "18" });
    expect(result.success).toBe(false);
  });
});

describe("apiEnvSchema", () => {
  it("refuses local storage in production", () => {
    const result = apiEnvSchema.safeParse({ NODE_ENV: "production", DATABASE_URL: "postgresql://x" });
    expect(result.success).toBe(false);
  });

  it("requires a Pinata token for Pinata storage", () => {
    const result = apiEnvSchema.safeParse({ DATABASE_URL: "postgresql://x", STORAGE_PROVIDER: "pinata" });
    expect(result.success).toBe(false);
  });

  it("refuses local networks in production", () => {
    const result = apiEnvSchema.safeParse({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://x",
      STORAGE_PROVIDER: "pinata",
      PINATA_JWT: "jwt",
      ENABLED_NETWORKS: "bsc-mainnet,bsc-local",
    });
    expect(result.success).toBe(false);
  });
});

describe("web env", () => {
  it("rejects unknown networks", () => {
    expect(webEnvSchema.safeParse({ VITE_ENABLED_NETWORKS: "bsc-mainnet,eth-mainnet" }).success).toBe(false);
  });

  it("flags secret-looking client variables", () => {
    expect(findLeakedClientSecrets({ VITE_PRIVATE_KEY: "x", VITE_API_URL: "y", PINATA_JWT: "z" })).toEqual(["VITE_PRIVATE_KEY"]);
  });
});
