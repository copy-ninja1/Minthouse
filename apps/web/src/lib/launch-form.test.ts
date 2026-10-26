import { splTokenConfigSchema } from "@minthouse/shared";
import { describe, expect, it } from "vitest";
import { initialCreateForm, logoFileError, modesForLaunch, networksForLaunch, toTokenConfig } from "./launch-form";

const CLIENT = ["bsc-testnet", "solana-devnet", "solana-mainnet"] as const;
const SERVER = ["bsc-testnet", "solana-devnet", "solana-mainnet"] as const;
const PUMP = ["solana-devnet"] as const;
const WALLET = "So11111111111111111111111111111111111111112";

describe("launch form", () => {
  it("offers Pump.fun only on clusters the API will verify", () => {
    expect(modesForLaunch(CLIENT, SERVER, PUMP)).toEqual(["bsc-erc20", "solana-spl", "pumpfun"]);
    expect(networksForLaunch("pumpfun", CLIENT, SERVER, PUMP)).toEqual(["solana-devnet"]);
    expect(networksForLaunch("pumpfun", CLIENT, SERVER, [])).toEqual([]);
  });

  it("builds an SPL config and sends the supply to the connected wallet when recipient is blank", () => {
    const values = {
      ...initialCreateForm("solana-spl", "solana-devnet"),
      name: "Lifecycle",
      symbol: "LIFE",
      decimals: "6",
      initialSupply: "1000000",
    };
    const result = toTokenConfig(values, WALLET);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.config).toEqual(
      splTokenConfigSchema.parse({
        mode: "solana-spl",
        network: "solana-devnet",
        name: "Lifecycle",
        symbol: "LIFE",
        description: "",
        decimals: 6,
        initialSupply: "1000000",
        recipient: WALLET,
        mintAuthority: "revoke",
        metadataMutable: false,
      }),
    );
  });

  it("reports every invalid field instead of stopping at the first", () => {
    const values = {
      ...initialCreateForm("bsc-erc20", "bsc-testnet"),
      symbol: "NO SPACE",
      decimals: "18.5",
      initialSupply: "0",
      mintingEnabled: false,
    };
    const result = toTokenConfig(values, null);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.fieldErrors.symbol).toMatch(/letters and numbers/);
    expect(result.fieldErrors.decimals).toMatch(/whole number/);
    expect(result.fieldErrors.recipient).toMatch(/wallet/);
    expect(result.fieldErrors.initialSupply).toMatch(/non-zero/);
  });

  it("rejects logos that are not images or are too large", () => {
    expect(logoFileError(new File(["x"], "a.gif", { type: "image/gif" }), 2_000_000)).toMatch(/PNG/);
    expect(logoFileError(new File([new Uint8Array(20)], "a.png", { type: "image/png" }), 10)).toMatch(/MB/);
    expect(logoFileError(new File(["x"], "a.png", { type: "image/png" }), 2_000_000)).toBeNull();
  });
});
