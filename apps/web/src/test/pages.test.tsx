import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/stores/theme";
import { routeTree } from "@/routeTree.gen";

vi.mock("@minthouse/blockchain/pump", () => ({
  fetchPumpProtocol: vi.fn(),
  planPumpLaunch: vi.fn(),
  PumpUnavailableError: class PumpUnavailableError extends Error {
    override name = "PumpUnavailableError";
  },
}));

vi.mock("@/api/endpoints", () => ({
  searchTokens: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  fetchPublicConfig: vi.fn().mockResolvedValue({
    networks: ["bsc-testnet", "solana-devnet"],
    storage: {
      provider: "local-dev",
      persistent: false,
      maxLogoBytes: 2_000_000,
    },
    pumpfunNetworks: ["solana-devnet"],
  }),
  lookupToken: vi.fn(),
}));

function renderRoute(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient },
  });
  render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe("pages", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders the landing page without asking for a wallet", async () => {
    renderRoute("/");
    expect(
      await screen.findByRole("heading", { name: /mint a token/i }),
    ).toBeInTheDocument();
    const launchLinks = screen.getAllByRole("link", { name: "Launch app" });
    expect(launchLinks.length).toBeGreaterThan(0);
    for (const link of launchLinks) {
      expect(link).toHaveAttribute("href", "/app");
    }
    expect(
      screen.getByText(/never ask for your seed phrase/i),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("No verified launches yet."),
    ).toBeInTheDocument();
  });

  it("renders the explore page with an empty index and live server status", async () => {
    renderRoute("/app");
    expect(
      await screen.findByRole("heading", { name: "Explore tokens" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "No launches yet" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Inspect any token" }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/development copies/i)).toBeInTheDocument();
  });

  it("renders the create form for every enabled launch mode", async () => {
    renderRoute("/app/create");
    expect(
      await screen.findByRole("heading", { name: "Create a token" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /BNB Chain/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /Solana SPL/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /Pump\.fun/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create token" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/never asks for your seed phrase/i),
    ).toBeInTheDocument();
  });
});
