import { beforeEach, describe, expect, it } from "vitest";
import { Keypair, PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { MAYHEM_PROGRAM_ID, PUMP_FEE_PROGRAM_ID, PUMP_PROGRAM_ID } from "@pump-fun/pump-sdk";
import { type PumpfunConfig, pumpfunConfigSchema, splTokenConfigSchema } from "@minthouse/shared";
import { LiteSvmConnection } from "../solana/testing/litesvm-connection.js";
import { FIXTURE_ACCOUNTS, PUMP_FIXTURE_PROGRAMS, fixturePath, fixturesAvailable, loadFixtureAccount } from "../solana/testing/fixtures.js";
import { buildTransaction, simulateTransaction } from "../solana/transactions.js";
import { readMintState, readTokenBalance } from "../solana/state.js";
import { planCreateSplToken } from "../solana/spl.js";
import { TOKEN_METADATA_PROGRAM_ID } from "../solana/metadata.js";
import { reconcileSolanaSignature } from "../solana/reconcile.js";
import { NotAPumpCoinError, readPumpCoin } from "./coin.js";
import { classifyPumpError } from "./errors.js";
import { planPumpLaunch } from "./launch.js";
import { PUMP_EXPECTED_TOTAL_SUPPLY, type PumpProtocol, fetchPumpProtocol } from "./protocol.js";
import { PumpTradeError, planPumpBuy, planPumpSell, quotePumpBuy } from "./trade.js";
import { verifyPumpLaunch } from "./verify.js";

const METADATA_URI = "https://ipfs.io/ipfs/bafkreia2xtwwdys4dxonlzjod5yxdz7tkiut5l2sgrdrh4d7b7ykxjmu5u";
const SOL = 1_000_000_000n;
const hasFixtures = await fixturesAvailable([
  ...PUMP_FIXTURE_PROGRAMS.map((name) => `${name}.so`),
  "mpl_token_metadata.so",
  ...FIXTURE_ACCOUNTS.map((account) => `${account.name}.json`),
]);

describe.skipIf(!hasFixtures)("Pump.fun integration (LiteSVM + mainnet Pump programs)", () => {
  let rpc: LiteSvmConnection;
  let protocol: PumpProtocol;
  let creator: Keypair;
  let trader: Keypair;

  beforeEach(async () => {
    rpc = new LiteSvmConnection();
    await rpc.loadProgram(PUMP_PROGRAM_ID, fixturePath("pump.so"));
    await rpc.loadProgram(PUMP_FEE_PROGRAM_ID, fixturePath("pump_fees.so"));
    await rpc.loadProgram(MAYHEM_PROGRAM_ID, fixturePath("mayhem.so"));
    await rpc.loadProgram(TOKEN_METADATA_PROGRAM_ID, fixturePath("mpl_token_metadata.so"));
    for (const account of FIXTURE_ACCOUNTS) {
      await loadFixtureAccount(rpc, account.name);
    }
    creator = Keypair.generate();
    trader = Keypair.generate();
    rpc.airdrop(creator.publicKey, 1_000n * SOL);
    rpc.airdrop(trader.publicKey, 1_000n * SOL);
    protocol = await fetchPumpProtocol(rpc.asConnection());
    // Protocol fee wallets are funded accounts on mainnet; a fresh SVM must mirror that or
    // small fees would leave them below rent exemption.
    const { global } = protocol;
    for (const wallet of [global.feeRecipient, ...global.feeRecipients, global.reservedFeeRecipient, ...global.reservedFeeRecipients, ...global.buybackFeeRecipients]) {
      if (!wallet.equals(PublicKey.default)) {
        rpc.airdrop(wallet, SOL);
      }
    }
  });

  function config(overrides: Partial<PumpfunConfig> = {}): PumpfunConfig {
    return pumpfunConfigSchema.parse({ mode: "pumpfun", network: "solana-devnet", name: "Minthouse Pump", symbol: "MHP", description: "", ...overrides });
  }

  async function send(signer: Keypair, instructions: TransactionInstruction[], extra: Keypair[] = []) {
    const prepared = await buildTransaction(rpc.asConnection(), signer.publicKey, instructions);
    const simulation = await simulateTransaction(rpc.asConnection(), prepared, signer.publicKey);
    const signature = await rpc.signAndSend(prepared.transaction, [signer, ...extra]);
    const status = await reconcileSolanaSignature(rpc.asConnection(), { signature });
    return { signature, simulation, status };
  }

  async function launch(cfg: PumpfunConfig) {
    const plan = await planPumpLaunch(protocol, { creator: creator.publicKey, config: cfg, metadataUri: METADATA_URI });
    const result = await send(creator, plan.instructions, [plan.mint]);
    return { plan, ...result };
  }

  it("reads the live protocol configuration", () => {
    expect(protocol.tokenTotalSupply).toBe(PUMP_EXPECTED_TOTAL_SUPPLY);
    expect(protocol.createV2Enabled).toBe(true);
    expect(protocol.initialRealTokenReserves).toBeGreaterThan(0n);
  });

  it("launches through the Pump program and verifies the result on-chain", async () => {
    const cfg = config();
    const { plan, signature, simulation, status } = await launch(cfg);
    expect(simulation.ok, simulation.logs.join("\n")).toBe(true);
    expect(status.state).toBe("finalized");
    expect(plan.initialBuy).toBeNull();

    const check = await verifyPumpLaunch(rpc.asConnection(), {
      signature,
      mint: plan.mint.publicKey.toBase58(),
      creator: creator.publicKey.toBase58(),
      expected: cfg,
      metadataUri: METADATA_URI,
    });
    expect(check, JSON.stringify(check)).toMatchObject({ status: "verified" });

    const mint = await readMintState(rpc.asConnection(), plan.mint.publicKey.toBase58());
    expect(mint.tokenProgramId.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
    expect(mint.decimals).toBe(6);
    expect(mint.supply).toBe(PUMP_EXPECTED_TOTAL_SUPPLY);
    expect(mint.mintAuthority).toBeNull();
    expect(mint.metadata).toMatchObject({ name: cfg.name, symbol: cfg.symbol, uri: METADATA_URI });

    const coin = await readPumpCoin(rpc.asConnection(), protocol, plan.mint.publicKey);
    expect(coin).toMatchObject({ phase: "bonding", creator: creator.publicKey.toBase58(), quoteMint: null, progressBps: 0, isMayhemMode: false });
    expect(coin.realTokenReserves).toBe(protocol.initialRealTokenReserves);
  });

  it.each([
    ["0.1", SOL / 10n],
    ["0.5", SOL / 2n],
  ])("includes an explicitly configured %s SOL initial buy atomically, bounded by slippage", async (initialBuySol, lamports) => {
    const cfg = config({ initialBuySol, slippageBps: 200 });
    const { plan, simulation, status } = await launch(cfg);
    expect(status.state, JSON.stringify(status)).toBe("finalized");
    expect(plan.initialBuy).not.toBeNull();
    const quote = plan.initialBuy!;
    expect(quote.maxCostLamports).toBe((lamports * 10_200n) / 10_000n);
    const balance = await readTokenBalance(rpc.asConnection(), { mint: plan.mint.publicKey, owner: creator.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID });
    expect(balance).toBe(quote.tokensOut);
    // The creator paid at most the cap plus rent deposits for the new accounts.
    expect(simulation.payerLamportsDelta).not.toBeNull();
    expect(simulation.payerLamportsDelta! - quote.maxCostLamports).toBeLessThan(SOL / 10n);
  });

  it("buys and sells on the curve with protocol-computed amounts", async () => {
    const { plan } = await launch(config());
    const mint = plan.mint.publicKey;

    const buy = await planPumpBuy(rpc.asConnection(), protocol, { mint, user: trader.publicKey, lamports: 2n * SOL, slippageBps: 100 });
    const bought = await send(trader, buy.instructions);
    expect(bought.status.state).toBe("finalized");
    const held = await readTokenBalance(rpc.asConnection(), { mint, owner: trader.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID });
    expect(held).toBe(buy.quote.tokensOut);
    expect((await readPumpCoin(rpc.asConnection(), protocol, mint)).progressBps).toBeGreaterThan(0);

    const sell = await planPumpSell(rpc.asConnection(), protocol, { mint, user: trader.publicKey, tokens: held / 2n, slippageBps: 100 });
    const before = await rpc.getBalance(trader.publicKey);
    const sold = await send(trader, sell.instructions);
    expect(sold.status.state).toBe("finalized");
    const received = BigInt((await rpc.getBalance(trader.publicKey)) - before);
    expect(received + 10_000n).toBeGreaterThanOrEqual(sell.quote.minLamportsOut);
    expect(await readTokenBalance(rpc.asConnection(), { mint, owner: trader.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID })).toBe(held - held / 2n);
  });

  it("refuses a buy when the price moved beyond the slippage limit", async () => {
    const { plan } = await launch(config());
    const mint = plan.mint.publicKey;
    const stale = await planPumpBuy(rpc.asConnection(), protocol, { mint, user: trader.publicKey, lamports: SOL, slippageBps: 50 });

    const frontRun = await planPumpBuy(rpc.asConnection(), protocol, { mint, user: creator.publicKey, lamports: 20n * SOL, slippageBps: 100 });
    expect((await send(creator, frontRun.instructions)).status.state).toBe("finalized");

    const attempt = await send(trader, stale.instructions);
    expect(attempt.status.state).toBe("failed");
    expect(attempt.simulation.ok).toBe(false);
    expect(classifyPumpError(attempt.simulation.error, attempt.simulation.logs).code).toBe("SLIPPAGE_EXCEEDED");
    expect(await readTokenBalance(rpc.asConnection(), { mint, owner: trader.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID })).toBe(0n);
  });

  it("reports a completed curve and refuses further curve trades", async () => {
    const { plan } = await launch(config());
    const mint = plan.mint.publicKey;
    const buyAll = await planPumpBuy(rpc.asConnection(), protocol, { mint, user: trader.publicKey, lamports: 500n * SOL, slippageBps: 100 });
    expect(buyAll.quote.tokensOut).toBe(protocol.initialRealTokenReserves);
    const result = await send(trader, buyAll.instructions);
    expect(result.status.state, result.simulation.logs.slice(-5).join("\n")).toBe("finalized");

    const coin = await readPumpCoin(rpc.asConnection(), protocol, mint);
    expect(coin.phase).toBe("complete");
    expect(coin.progressBps).toBe(10_000);
    await expect(planPumpBuy(rpc.asConnection(), protocol, { mint, user: trader.publicKey, lamports: SOL, slippageBps: 100 })).rejects.toThrow(PumpTradeError);
  });

  it("does not accept a standard SPL token as a Pump launch", async () => {
    const spl = splTokenConfigSchema.parse({
      mode: "solana-spl",
      network: "solana-local",
      name: "Minthouse Pump",
      symbol: "MHP",
      description: "",
      decimals: 6,
      initialSupply: "1000000000",
      recipient: creator.publicKey.toBase58(),
      mintAuthority: "revoke",
      metadataMutable: false,
    });
    const plan = await planCreateSplToken(rpc.asConnection(), { creator: creator.publicKey, config: spl, metadataUri: METADATA_URI });
    const { signature } = await send(creator, plan.instructions, [plan.mint]);
    const check = await verifyPumpLaunch(rpc.asConnection(), {
      signature,
      mint: plan.mint.publicKey.toBase58(),
      creator: creator.publicKey.toBase58(),
      expected: config(),
      metadataUri: METADATA_URI,
    });
    expect(check).toMatchObject({ status: "mismatch", reason: "The transaction did not call the Pump program." });
    await expect(readPumpCoin(rpc.asConnection(), protocol, plan.mint.publicKey)).rejects.toThrow(NotAPumpCoinError);
  });

  it("rejects verification for a different creator or metadata", async () => {
    const cfg = config();
    const { plan, signature } = await launch(cfg);
    const base = { signature, mint: plan.mint.publicKey.toBase58(), expected: cfg, metadataUri: METADATA_URI };
    expect(await verifyPumpLaunch(rpc.asConnection(), { ...base, creator: trader.publicKey.toBase58() })).toMatchObject({ status: "mismatch" });
    expect(
      await verifyPumpLaunch(rpc.asConnection(), { ...base, creator: creator.publicKey.toBase58(), expected: { ...cfg, symbol: "OTHER" } }),
    ).toMatchObject({ status: "mismatch" });
  });

  it("validates quote inputs before building anything", () => {
    const curve = { ...protocol.global } as unknown;
    expect(() => quotePumpBuy(protocol, curve as never, 0n, 100)).toThrow(PumpTradeError);
    expect(() => quotePumpBuy(protocol, curve as never, SOL, 0)).toThrow(PumpTradeError);
    expect(() => quotePumpBuy(protocol, curve as never, SOL, 5_001)).toThrow(PumpTradeError);
  });

  it("rejects non-https metadata URIs", async () => {
    await expect(
      planPumpLaunch(protocol, { creator: creator.publicKey, config: config(), metadataUri: "http://example.com/meta.json" }),
    ).rejects.toThrow(RangeError);
    expect(PublicKey.isOnCurve(creator.publicKey)).toBe(true);
  });
});
