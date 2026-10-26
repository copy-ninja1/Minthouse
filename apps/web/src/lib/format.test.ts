import { describe, expect, it } from "vitest";
import { formatBaseUnits, formatBps, formatRelativeTime, safeHttpUrl } from "./format";

describe("formatBaseUnits", () => {
  it("formats base units with integer math and drops trailing zeros", () => {
    expect(formatBaseUnits("1000000000000000000", 18)).toBe("1");
    expect(formatBaseUnits("1500000", 6)).toBe("1.5");
    expect(formatBaseUnits(null, 9)).toBeNull();
    expect(formatBaseUnits("not-a-number", 9)).toBeNull();
  });
});

describe("formatBps", () => {
  it("renders basis points as a percentage", () => {
    expect(formatBps(4250)).toBe("42.5%");
    expect(formatBps(10_000)).toBe("100%");
  });
});

describe("formatRelativeTime", () => {
  it("describes a past timestamp relative to a fixed clock", () => {
    const now = new Date("2026-10-26T20:00:00.000Z");
    expect(formatRelativeTime("2026-10-26T19:00:00.000Z", now)).toBe("1 hour ago");
    expect(formatRelativeTime("not-a-date", now)).toBeNull();
  });
});

describe("safeHttpUrl", () => {
  it("keeps http(s) urls and drops everything else", () => {
    expect(safeHttpUrl("https://ipfs.io/ipfs/abc")).toBe("https://ipfs.io/ipfs/abc");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("/relative")).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
  });
});
