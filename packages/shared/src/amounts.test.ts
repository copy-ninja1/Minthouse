import { describe, expect, it } from "vitest";
import {
  AmountError,
  U64_MAX,
  UINT256_MAX,
  fitsU64,
  fitsUint256,
  formatTokenAmount,
  parseTokenAmount,
  wholeTokensToBaseUnits,
} from "./amounts.js";

describe("wholeTokensToBaseUnits", () => {
  it("converts the documented BSC example exactly", () => {
    expect(wholeTokensToBaseUnits("1000000000000000", 18)).toBe(
      10n ** 15n * 10n ** 18n,
    );
  });

  it("converts the documented Solana example exactly", () => {
    expect(wholeTokensToBaseUnits("1000000000000000", 9)).toBe(10n ** 24n);
  });

  it("rejects fractional and malformed whole-token input", () => {
    expect(() => wholeTokensToBaseUnits("1.5", 9)).toThrow(AmountError);
    expect(() => wholeTokensToBaseUnits("1e9", 9)).toThrow(AmountError);
    expect(() => wholeTokensToBaseUnits("1,000", 9)).toThrow(AmountError);
    expect(() => wholeTokensToBaseUnits("-1", 9)).toThrow(AmountError);
    expect(() => wholeTokensToBaseUnits("007", 9)).toThrow(AmountError);
  });

  it("rejects invalid decimals", () => {
    expect(() => wholeTokensToBaseUnits("1", -1)).toThrow(AmountError);
    expect(() => wholeTokensToBaseUnits("1", 1.5)).toThrow(AmountError);
  });
});

describe("chain limits", () => {
  it("shows the documented Solana example does not fit in u64", () => {
    expect(fitsU64(wholeTokensToBaseUnits("1000000000000000", 9))).toBe(false);
    expect(fitsU64(wholeTokensToBaseUnits("18446744073", 9))).toBe(true);
    expect(fitsU64(wholeTokensToBaseUnits("18", 18))).toBe(true);
    expect(fitsU64(wholeTokensToBaseUnits("19", 18))).toBe(false);
    expect(fitsU64(U64_MAX + 1n)).toBe(false);
  });

  it("checks the uint256 ceiling", () => {
    expect(fitsUint256(UINT256_MAX)).toBe(true);
    expect(fitsUint256(UINT256_MAX + 1n)).toBe(false);
  });
});

describe("parseTokenAmount", () => {
  it("parses decimals without floating point error", () => {
    expect(parseTokenAmount("0.1", 18)).toBe(100000000000000000n);
    expect(parseTokenAmount("123456789.123456789", 9)).toBe(
      123456789123456789n,
    );
    expect(parseTokenAmount("5", 0)).toBe(5n);
  });

  it("refuses to round away precision", () => {
    expect(() => parseTokenAmount("0.0000000001", 9)).toThrow(
      "At most 9 decimal places",
    );
  });
});

describe("formatTokenAmount", () => {
  it("formats with grouping and trims trailing zeros", () => {
    expect(formatTokenAmount(1_500_000_000_000_000_000_000n, 18)).toBe("1,500");
    expect(formatTokenAmount(1_234_500n, 3)).toBe("1,234.5");
    expect(formatTokenAmount(1n, 9)).toBe("0.000000001");
  });

  it("truncates rather than rounds", () => {
    expect(formatTokenAmount(1_999_999n, 6, { maxFractionDigits: 2 })).toBe(
      "1.99",
    );
  });

  it("round-trips with parseTokenAmount", () => {
    const raw = parseTokenAmount("98765.4321", 9);
    expect(formatTokenAmount(raw, 9, { group: false })).toBe("98765.4321");
  });
});
