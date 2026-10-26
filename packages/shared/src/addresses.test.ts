import { describe, expect, it } from "vitest";
import { isEvmAddress, isSolanaAddress, normalizeAddress, sameAddress, shortenAddress } from "./addresses.js";

describe("address validation", () => {
  it("validates EVM addresses with checksum", () => {
    expect(isEvmAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8")).toBe(true);
    expect(isEvmAddress("0x70997970c51812dc3a010c7d01b50e0d17dc79c8")).toBe(true);
    expect(isEvmAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79c8")).toBe(false);
    expect(isEvmAddress("0x0000000000000000000000000000000000000000")).toBe(false);
    expect(isEvmAddress("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM")).toBe(false);
  });

  it("validates Solana public keys", () => {
    expect(isSolanaAddress("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM")).toBe(true);
    expect(isSolanaAddress("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")).toBe(true);
    expect(isSolanaAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8")).toBe(false);
    expect(isSolanaAddress("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWW0")).toBe(false);
    expect(isSolanaAddress("short")).toBe(false);
  });

  it("compares addresses canonically", () => {
    expect(
      sameAddress("bsc", "0x70997970c51812dc3a010c7d01b50e0d17dc79c8", "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"),
    ).toBe(true);
    expect(normalizeAddress("bsc", "0x70997970c51812dc3a010c7d01b50e0d17dc79c8")).toBe(
      "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    );
  });

  it("shortens addresses for display", () => {
    expect(shortenAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8")).toBe("0x7099…79C8");
    expect(shortenAddress("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM")).toBe("9WzD…AWWM");
  });
});
