import { describe, expect, it } from "vitest";
import { exploreSearchSchema } from "./explore-search";

describe("exploreSearchSchema", () => {
  it("keeps a trimmed query and a known network", () => {
    expect(exploreSearchSchema.parse({ q: "  cat  ", network: "solana-devnet" })).toEqual({
      q: "cat",
      network: "solana-devnet",
    });
  });

  it("drops malformed values instead of failing the route", () => {
    expect(exploreSearchSchema.parse({ q: "", network: "mainnet", token: "short", tokenNetwork: "nope" })).toEqual({});
  });
});
