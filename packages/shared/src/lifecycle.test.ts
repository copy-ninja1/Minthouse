import { describe, expect, it } from "vitest";
import { OPERATION_STATUSES, assertTransition, canTransition, isTerminalStatus, mayBeOnChain, transitionPath } from "./lifecycle.js";
import { canonicalJson, deriveIdempotencyKey } from "./idempotency.js";
import { isSafeToRetry } from "./errors.js";

describe("operation lifecycle", () => {
  it("never treats submission as completion", () => {
    expect(canTransition("submitted", "completed")).toBe(false);
    expect(canTransition("confirming", "completed")).toBe(false);
    expect(canTransition("verifying", "completed")).toBe(true);
  });

  it("cannot return to wallet approval once a transaction may be on-chain", () => {
    for (const status of OPERATION_STATUSES.filter(mayBeOnChain)) {
      expect(canTransition(status, "awaiting-approval")).toBe(false);
      expect(canTransition(status, "validating")).toBe(false);
    }
  });

  it("only allows a fresh attempt from failed or cancelled", () => {
    expect(canTransition("failed", "validating")).toBe(true);
    expect(canTransition("cancelled", "validating")).toBe(true);
    expect(canTransition("completed", "validating")).toBe(false);
  });

  it("throws on invalid transitions", () => {
    expect(() => {
      assertTransition("draft", "completed");
    }).toThrow("draft → completed");
  });

  it("finds the legal path between statuses", () => {
    expect(transitionPath("submitted", "completed")).toEqual(["confirming", "verifying", "completed"]);
    expect(transitionPath("failed", "submitted")).toEqual(["validating", "awaiting-approval", "submitted"]);
    expect(transitionPath("submitted", "submitted")).toEqual([]);
    expect(transitionPath("completed", "failed")).toBeNull();
    expect(transitionPath("confirming", "awaiting-approval")).toBeNull();
  });

  it("classifies terminal states", () => {
    expect(isTerminalStatus("completed")).toBe(true);
    expect(isTerminalStatus("requires-recovery")).toBe(false);
  });

  it("does not consider an uncertain outcome safe to retry", () => {
    expect(isSafeToRetry("CONFIRMATION_TIMEOUT")).toBe(false);
    expect(isSafeToRetry("UNKNOWN")).toBe(false);
    expect(isSafeToRetry("RPC_FAILURE")).toBe(false);
    expect(isSafeToRetry("USER_REJECTED")).toBe(true);
  });
});

describe("idempotency keys", () => {
  it("is independent of key order and ignores undefined", () => {
    expect(canonicalJson({ b: 1, a: [1, { d: 2, c: 3 }], z: undefined })).toBe('{"a":[1,{"c":3,"d":2}],"b":1}');
  });

  it("derives stable hex keys", async () => {
    const a = await deriveIdempotencyKey({ wallet: "x", config: { name: "A", symbol: "B" } });
    const b = await deriveIdempotencyKey({ config: { symbol: "B", name: "A" }, wallet: "x" });
    const c = await deriveIdempotencyKey({ wallet: "y", config: { name: "A", symbol: "B" } });
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
