import { describe, expect, it } from "vitest";
import { RECOVERY_AFTER_MS, decideDeployment } from "../src/deployments/chain-outcome.js";

const now = new Date("2026-10-26T12:00:00Z");
const recently = new Date(now.getTime() - 60_000);
const longAgo = new Date(now.getTime() - RECOVERY_AFTER_MS - 1);

describe("decideDeployment", () => {
  it("completes only on verified on-chain state", () => {
    const decision = decideDeployment(
      { status: "submitted", submittedAt: recently },
      { kind: "verified", tokenAddress: "Mint111", totalSupply: "1000", details: { name: "X" } },
      now,
    );
    expect(decision).toMatchObject({ status: "completed", errorCode: null, tokenAddress: "Mint111", totalSupply: "1000" });
    expect(decision?.verification).toMatchObject({ verified: true, details: { name: "X" } });
  });

  it("fails with VERIFICATION_FAILED when the chain disagrees with the request", () => {
    const decision = decideDeployment(
      { status: "confirming", submittedAt: recently },
      { kind: "mismatch", tokenAddress: "Mint111", reason: "Decimals differ", details: {} },
      now,
    );
    expect(decision).toMatchObject({ status: "failed", errorCode: "VERIFICATION_FAILED" });
    expect(decision?.verification).toMatchObject({ verified: false, summary: "Decimals differ" });
  });

  it("records definitive failures with their code", () => {
    expect(
      decideDeployment({ status: "submitted", submittedAt: recently }, { kind: "failed", code: "EXPIRED", reason: "expired" }, now),
    ).toMatchObject({ status: "failed", errorCode: "EXPIRED" });
  });

  it("moves to confirming once the network has seen the transaction", () => {
    expect(decideDeployment({ status: "submitted", submittedAt: recently }, { kind: "pending" }, now)).toMatchObject({
      status: "confirming",
    });
    expect(decideDeployment({ status: "confirming", submittedAt: recently }, { kind: "pending" }, now)).toBeNull();
  });

  it("waits on unknown outcomes, then asks for recovery instead of guessing", () => {
    expect(decideDeployment({ status: "submitted", submittedAt: recently }, { kind: "unknown" }, now)).toBeNull();
    expect(decideDeployment({ status: "submitted", submittedAt: longAgo }, { kind: "unknown" }, now)).toMatchObject({
      status: "requires-recovery",
      errorCode: "CONFIRMATION_TIMEOUT",
    });
    expect(decideDeployment({ status: "requires-recovery", submittedAt: longAgo }, { kind: "unknown" }, now)).toBeNull();
  });

  it("can still complete from recovery when the chain later proves success", () => {
    expect(
      decideDeployment(
        { status: "requires-recovery", submittedAt: longAgo },
        { kind: "verified", tokenAddress: "Mint111", totalSupply: "1", details: {} },
        now,
      ),
    ).toMatchObject({ status: "completed" });
  });

  it("never changes a completed or cancelled deployment", () => {
    const verified = { kind: "verified", tokenAddress: "M", totalSupply: "1", details: {} } as const;
    expect(decideDeployment({ status: "completed", submittedAt: recently }, verified, now)).toBeNull();
    expect(decideDeployment({ status: "completed", submittedAt: recently }, { kind: "failed", code: "REVERTED", reason: "" }, now)).toBeNull();
    expect(decideDeployment({ status: "cancelled", submittedAt: null }, verified, now)).toBeNull();
  });
});
