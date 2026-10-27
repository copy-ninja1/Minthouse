import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { type SplTokenConfig, splTokenConfigSchema } from "@minthouse/shared";
import { LiteSvmConnection } from "./testing/litesvm-connection.js";
import { FIXTURE_PROGRAMS, fixturePath, fixturesAvailable } from "./testing/fixtures.js";
import { TOKEN_METADATA_PROGRAM_ID, findMetadataAddress } from "./metadata.js";
import {
  associatedTokenAddress,
  burnInstructions,
  mintToInstructions,
  planCreateSplToken,
  setMintAuthorityInstructions,
  transferInstructions,
} from "./spl.js";
import { buildTransaction, simulateTransaction } from "./transactions.js";
import { readMintState, readTokenBalance } from "./state.js";
import { verifySplDeployment } from "./verify.js";
import { reconcileSolanaSignature } from "./reconcile.js";
import { classifySolanaError } from "./errors.js";

const METADATA_URI = "https://ipfs.io/ipfs/bafkreia2xtwwdys4dxonlzjod5yxdz7tkiut5l2sgrdrh4d7b7ykxjmu5u";
const hasFixtures = await fixturesAvailable(FIXTURE_PROGRAMS.map((program) => `${program.name}.so`));

describe.skipIf(!hasFixtures)("standard SPL token lifecycle (LiteSVM + real programs)", () => {
  let rpc: LiteSvmConnection;
  let creator: Keypair;
  let holder: Keypair;
  let outsider: Keypair;

  beforeAll(() => {
    if (!hasFixtures) {
      console.warn("Skipping: run `pnpm --filter @minthouse/blockchain fixtures` to download program binaries.");
    }
  });

  beforeEach(async () => {
    rpc = new LiteSvmConnection();
    await rpc.loadProgram(TOKEN_METADATA_PROGRAM_ID, fixturePath("mpl_token_metadata.so"));
    creator = Keypair.generate();
    holder = Keypair.generate();
    outsider = Keypair.generate();
    for (const account of [creator, holder, outsider]) {
      rpc.airdrop(account.publicKey, 10_000_000_000n);
    }
  });

  function config(overrides: Partial<SplTokenConfig> = {}): SplTokenConfig {
    return splTokenConfigSchema.parse({
      mode: "solana-spl",
      network: "solana-local",
      name: "Minthouse Test",
      symbol: "MHT",
      description: "",
      decimals: 9,
      initialSupply: "1000000",
      recipient: holder.publicKey.toBase58(),
      mintAuthority: "retain",
      metadataMutable: true,
      ...overrides,
    });
  }

  async function createToken(cfg: SplTokenConfig) {
    const connection = rpc.asConnection();
    const plan = await planCreateSplToken(connection, { creator: creator.publicKey, config: cfg, metadataUri: METADATA_URI });
    const prepared = await buildTransaction(connection, creator.publicKey, plan.instructions);
    const simulation = await simulateTransaction(connection, prepared, creator.publicKey);
    const signature = await rpc.signAndSend(prepared.transaction, [creator, plan.mint]);
    return { plan, prepared, simulation, signature };
  }

  async function send(signer: Keypair, instructions: Parameters<typeof buildTransaction>[2]) {
    const prepared = await buildTransaction(rpc.asConnection(), signer.publicKey, instructions);
    const signature = await rpc.signAndSend(prepared.transaction, [signer]);
    return { signature, status: await reconcileSolanaSignature(rpc.asConnection(), { signature }) };
  }

  it("creates mint, metadata and initial supply atomically, and verifies it", async () => {
    const cfg = config();
    const { plan, simulation, signature } = await createToken(cfg);

    expect(simulation.ok).toBe(true);
    expect(simulation.payerLamportsDelta).toBeGreaterThan(0n);

    const check = await verifySplDeployment(rpc.asConnection(), {
      signature,
      mint: plan.mint.publicKey.toBase58(),
      creator: creator.publicKey.toBase58(),
      expected: cfg,
      metadataUri: METADATA_URI,
    });
    expect(check.status).toBe("verified");

    const state = await readMintState(rpc.asConnection(), plan.mint.publicKey.toBase58());
    expect(state.tokenProgram).toBe("spl-token");
    expect(state.decimals).toBe(9);
    expect(state.supply).toBe(1_000_000n * 10n ** 9n);
    expect(state.mintAuthority).toBe(creator.publicKey.toBase58());
    expect(state.freezeAuthority).toBeNull();
    expect(state.metadata).toMatchObject({ source: "metaplex", name: "Minthouse Test", symbol: "MHT", uri: METADATA_URI, isMutable: true });
    expect(state.metadata?.updateAuthority).toBe(creator.publicKey.toBase58());

    // Mint address and token account address are distinct, and the holder's ATA holds the supply.
    expect(plan.recipientTokenAccount?.equals(plan.mint.publicKey)).toBe(false);
    const balance = await readTokenBalance(rpc.asConnection(), {
      mint: plan.mint.publicKey,
      owner: holder.publicKey,
      tokenProgram: state.tokenProgramId,
    });
    expect(balance).toBe(state.supply);
  });

  it("creates the Metaplex metadata account at the canonical PDA", async () => {
    const { plan } = await createToken(config());
    const metadata = await rpc.getAccountInfo(findMetadataAddress(plan.mint.publicKey));
    expect(metadata?.owner.equals(TOKEN_METADATA_PROGRAM_ID)).toBe(true);
  });

  it("supports immutable metadata", async () => {
    const cfg = config({ metadataMutable: false });
    const { plan } = await createToken(cfg);
    const state = await readMintState(rpc.asConnection(), plan.mint.publicKey.toBase58());
    expect(state.metadata?.isMutable).toBe(false);
  });

  it("revokes mint authority at creation when requested", async () => {
    const cfg = config({ mintAuthority: "revoke" });
    const { plan, signature } = await createToken(cfg);
    const state = await readMintState(rpc.asConnection(), plan.mint.publicKey.toBase58());
    expect(state.mintAuthority).toBeNull();
    const check = await verifySplDeployment(rpc.asConnection(), {
      signature,
      mint: plan.mint.publicKey.toBase58(),
      creator: creator.publicKey.toBase58(),
      expected: cfg,
      metadataUri: METADATA_URI,
    });
    expect(check.status).toBe("verified");
  });

  it("rejects verification against a different configuration", async () => {
    const cfg = config();
    const { plan, signature } = await createToken(cfg);
    const base = { signature, mint: plan.mint.publicKey.toBase58(), metadataUri: METADATA_URI };
    const wrongSupply = await verifySplDeployment(rpc.asConnection(), {
      ...base,
      creator: creator.publicKey.toBase58(),
      expected: { ...cfg, initialSupply: "1" },
    });
    expect(wrongSupply.status).toBe("mismatch");
    const wrongCreator = await verifySplDeployment(rpc.asConnection(), { ...base, creator: outsider.publicKey.toBase58(), expected: cfg });
    expect(wrongCreator.status).toBe("mismatch");
    const wrongUri = await verifySplDeployment(rpc.asConnection(), {
      ...base,
      creator: creator.publicKey.toBase58(),
      expected: cfg,
      metadataUri: `${METADATA_URI}x`,
    });
    expect(wrongUri.status).toBe("mismatch");
  });

  it("reports an unknown signature as pending, not failed", async () => {
    const check = await verifySplDeployment(rpc.asConnection(), {
      signature: "5".repeat(88),
      mint: Keypair.generate().publicKey.toBase58(),
      creator: creator.publicKey.toBase58(),
      expected: config(),
      metadataUri: METADATA_URI,
    });
    expect(check.status).toBe("pending");
  });

  it("mints more to a holder without an existing token account, transfers and burns", async () => {
    const { plan } = await createToken(config());
    const ref = { mint: plan.mint.publicKey, decimals: 9, tokenProgram: (await readMintState(rpc.asConnection(), plan.mint.publicKey.toBase58())).tokenProgramId };

    const minted = await send(creator, mintToInstructions(ref, { authority: creator.publicKey, payer: creator.publicKey, recipient: outsider.publicKey, amount: 5n }));
    expect(minted.status.state).toBe("finalized");
    expect(await readTokenBalance(rpc.asConnection(), { ...ref, owner: outsider.publicKey })).toBe(5n);

    const transferred = await send(holder, transferInstructions(ref, { owner: holder.publicKey, recipient: outsider.publicKey, amount: 10n }));
    expect(transferred.status.state).toBe("finalized");
    expect(await readTokenBalance(rpc.asConnection(), { ...ref, owner: outsider.publicKey })).toBe(15n);

    const burned = await send(outsider, burnInstructions(ref, { owner: outsider.publicKey, amount: 15n }));
    expect(burned.status.state).toBe("finalized");
    const state = await readMintState(rpc.asConnection(), plan.mint.publicKey.toBase58());
    expect(state.supply).toBe(1_000_000n * 10n ** 9n + 5n - 15n);
  });

  it("rejects minting by a wallet without mint authority", async () => {
    const { plan } = await createToken(config());
    const ref = { mint: plan.mint.publicKey, decimals: 9, tokenProgram: (await readMintState(rpc.asConnection(), plan.mint.publicKey.toBase58())).tokenProgramId };
    const attempt = await send(
      outsider,
      mintToInstructions(ref, { authority: outsider.publicKey, payer: outsider.publicKey, recipient: outsider.publicKey, amount: 1n }),
    );
    expect(attempt.status.state).toBe("failed");
    expect(classifySolanaError(new Error("tx failed"), rpc.logsFor(attempt.signature)).code).toBe("UNAUTHORIZED");
  });

  it("transfers mint authority, then revokes it so nobody can mint", async () => {
    const { plan } = await createToken(config());
    const ref = { mint: plan.mint.publicKey, tokenProgram: (await readMintState(rpc.asConnection(), plan.mint.publicKey.toBase58())).tokenProgramId };

    await send(creator, setMintAuthorityInstructions(ref, { currentAuthority: creator.publicKey, newAuthority: holder.publicKey }));
    expect((await readMintState(rpc.asConnection(), plan.mint.publicKey.toBase58())).mintAuthority).toBe(holder.publicKey.toBase58());

    const oldAuthority = await send(
      creator,
      mintToInstructions({ ...ref, decimals: 9 }, { authority: creator.publicKey, payer: creator.publicKey, recipient: creator.publicKey, amount: 1n }),
    );
    expect(oldAuthority.status.state).toBe("failed");

    await send(holder, setMintAuthorityInstructions(ref, { currentAuthority: holder.publicKey, newAuthority: null }));
    expect((await readMintState(rpc.asConnection(), plan.mint.publicKey.toBase58())).mintAuthority).toBeNull();

    const afterRevoke = await send(
      holder,
      mintToInstructions({ ...ref, decimals: 9 }, { authority: holder.publicKey, payer: holder.publicKey, recipient: holder.publicKey, amount: 1n }),
    );
    expect(afterRevoke.status.state).toBe("failed");
  });

  it("refuses zero and overflowing amounts before building a transaction", () => {
    const ref = { mint: Keypair.generate().publicKey, decimals: 9, tokenProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") };
    expect(() => transferInstructions(ref, { owner: creator.publicKey, recipient: holder.publicKey, amount: 0n })).toThrow(RangeError);
    expect(() => mintToInstructions(ref, { authority: creator.publicKey, payer: creator.publicKey, recipient: holder.publicKey, amount: 1n << 64n })).toThrow(
      RangeError,
    );
  });

  it("derives the recipient ATA under the correct owner", async () => {
    const { plan } = await createToken(config());
    expect(plan.recipientTokenAccount?.equals(associatedTokenAddress(plan.mint.publicKey, holder.publicKey))).toBe(true);
  });
});

describe("Solana transaction reconciliation", () => {
  it("only declares a missing signature expired after its last valid block height", async () => {
    const rpc = new LiteSvmConnection();
    const signature = "4".repeat(88);
    const { lastValidBlockHeight } = await rpc.getLatestBlockhash();
    expect((await reconcileSolanaSignature(rpc.asConnection(), { signature, lastValidBlockHeight })).state).toBe("unknown");
    rpc.advanceSlots(200);
    expect((await reconcileSolanaSignature(rpc.asConnection(), { signature, lastValidBlockHeight })).state).toBe("expired");
  });
});

describe("classifySolanaError", () => {
  it("recognises wallet rejection", () => {
    expect(classifySolanaError(new Error("User rejected the request.")).code).toBe("USER_REJECTED");
    expect(classifySolanaError({ code: 4001 }).code).toBe("USER_REJECTED");
  });

  it("recognises expiry, funds and RPC failures", () => {
    expect(classifySolanaError(new Error("Blockhash not found")).code).toBe("EXPIRED");
    expect(classifySolanaError(new Error("x"), ["Transfer: insufficient lamports 10, need 20"]).code).toBe("INSUFFICIENT_FUNDS");
    expect(classifySolanaError(new Error('"AccountNotFound"')).code).toBe("INSUFFICIENT_FUNDS");
    expect(classifySolanaError(new Error('"InsufficientFundsForFee"')).code).toBe("INSUFFICIENT_FUNDS");
    expect(classifySolanaError(new TypeError("Failed to fetch")).code).toBe("RPC_FAILURE");
    expect(
      classifySolanaError(new Error('403 Forbidden: {"jsonrpc":"2.0","error":{"code":403,"message":"Access forbidden"}}')).code,
    ).toBe("RPC_FAILURE");
  });

  it("does not guess", () => {
    expect(classifySolanaError(new Error("something odd")).code).toBe("UNKNOWN");
  });
});
