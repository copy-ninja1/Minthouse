import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TokenLookupForm } from "./TokenLookupForm";

const NETWORKS = ["bsc-testnet", "solana-devnet"] as const;

describe("TokenLookupForm", () => {
  it("rejects an address that does not belong to the selected chain", async () => {
    const onInspect = vi.fn();
    const user = userEvent.setup();
    render(<TokenLookupForm networks={NETWORKS} onInspect={onInspect} />);

    await user.type(screen.getByLabelText("Token address"), "not-an-address");
    await user.click(screen.getByRole("button", { name: "Inspect" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("BNB Smart Chain Testnet");
    expect(onInspect).not.toHaveBeenCalled();
  });

  it("normalizes a valid address before inspecting it", async () => {
    const onInspect = vi.fn();
    const user = userEvent.setup();
    render(<TokenLookupForm networks={NETWORKS} onInspect={onInspect} />);

    await user.type(screen.getByLabelText("Token address"), "0x70997970c51812dc3a010c7d01b50e0d17dc79c8");
    await user.click(screen.getByRole("button", { name: "Inspect" }));

    expect(onInspect).toHaveBeenCalledWith("bsc-testnet", "0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
  });

  it("validates Solana addresses when that network is selected", async () => {
    const onInspect = vi.fn();
    const user = userEvent.setup();
    render(<TokenLookupForm networks={NETWORKS} onInspect={onInspect} />);

    await user.selectOptions(screen.getByLabelText("Network"), "solana-devnet");
    await user.type(screen.getByLabelText("Token address"), "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
    await user.click(screen.getByRole("button", { name: "Inspect" }));

    expect(onInspect).toHaveBeenCalledWith("solana-devnet", "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
  });
});
