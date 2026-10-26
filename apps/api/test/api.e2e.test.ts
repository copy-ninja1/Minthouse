import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { Keypair } from "@solana/web3.js";
import { z } from "zod";
import {
  type Deployment,
  type LogoAsset,
  type PublishedMetadata,
  type SplTokenConfig,
  apiErrorSchema,
  deploymentSchema,
  metadataVerificationSchema,
  operationHistoryItemSchema,
  splTokenConfigSchema,
  tokenLookupSchema,
  tokenPageSchema,
} from "@minthouse/shared";
import { TOKEN_METADATA_PROGRAM_ID, buildTransaction, planCreateSplToken } from "@minthouse/blockchain/solana";
import { FIXTURE_PROGRAMS, LiteSvmConnection, fixturePath, fixturesAvailable } from "@minthouse/blockchain/testing";
import { ReconcileWorker } from "../src/reconcile/reconcile.worker.js";
import { type TestApp, createTestApp, randomKey, resetDatabase, testPng } from "./helpers.js";

const hasFixtures = await fixturesAvailable(FIXTURE_PROGRAMS.map((program) => `${program.name}.so`));

describe("API basics", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
  });

  it("reports liveness, readiness and public configuration", async () => {
    await request(t.app.getHttpServer()).get("/health/live").expect(200, { status: "ok" });
    await request(t.app.getHttpServer()).get("/health/ready").expect(200, { status: "ok", database: "ok", storage: "ok" });
    const config = await request(t.app.getHttpServer()).get("/config").expect(200);
    expect(config.body).toEqual({
      networks: ["solana-local", "bsc-local", "solana-mainnet"],
      storage: { provider: "local-dev", persistent: false, maxLogoBytes: t.env.MAX_LOGO_BYTES },
      pumpfunNetworks: ["solana-mainnet"],
    });
  });

  it("returns errors in the shared shape with a request id", async () => {
    const response = await request(t.app.getHttpServer())
      .post("/deployments")
      .set("x-request-id", "test-request-0001")
      .send({ idempotencyKey: "nope" })
      .expect(400);
    const body = apiErrorSchema.parse(response.body);
    expect(body.requestId).toBe("test-request-0001");
    expect(response.headers["x-request-id"]).toBe("test-request-0001");
    expect(body.issues?.map((issue) => issue.path)).toEqual(expect.arrayContaining(["idempotencyKey", "creator", "config"]));
  });

  it("sets security headers and restricts CORS to configured origins", async () => {
    const allowed = await request(t.app.getHttpServer()).get("/health/live").set("origin", "http://localhost:5173").expect(200);
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(allowed.headers["x-content-type-options"]).toBe("nosniff");
    expect(allowed.headers["x-powered-by"]).toBeUndefined();
    const denied = await request(t.app.getHttpServer()).get("/health/live").set("origin", "https://evil.example").expect(200);
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("uploads, normalises, serves and de-duplicates logos", async () => {
    const png = await testPng(400, 300);
    const first = await request(t.app.getHttpServer()).post("/assets/logo").attach("file", png, "logo.png").expect(201);
    const asset = first.body as LogoAsset;
    expect(asset).toMatchObject({ storage: "local-dev", persistent: false, width: 512, height: 512 });
    expect(asset.trustWalletImageUri).toMatch(/-256\.png$/);

    const served = await request(t.app.getHttpServer()).get(new URL(asset.imageUri).pathname).expect(200);
    expect(served.headers["content-type"]).toBe("image/png");
    expect(served.headers["x-content-type-options"]).toBe("nosniff");

    const again = await request(t.app.getHttpServer()).post("/assets/logo").attach("file", png, "renamed.png").expect(201);
    expect((again.body as LogoAsset).id).toBe(asset.id);
  });

  it("rejects disguised, tiny and missing logo uploads", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"></svg>');
    await request(t.app.getHttpServer()).post("/assets/logo").attach("file", svg, { filename: "logo.png", contentType: "image/png" }).expect(415);
    await request(t.app.getHttpServer()).post("/assets/logo").attach("file", await testPng(64, 64), "small.png").expect(422);
    await request(t.app.getHttpServer()).post("/assets/logo").expect(400);
    await request(t.app.getHttpServer()).get("/storage/missing.png").expect(404);
    await request(t.app.getHttpServer()).get("/storage/%2e%2e%2fpackage.json").expect((response) => {
      expect([400, 403, 404]).toContain(response.status);
    });
  });

  it("maps malformed and oversized bodies to client errors", async () => {
    await request(t.app.getHttpServer()).post("/deployments").set("content-type", "application/json").send("{not json").expect(400);
    await request(t.app.getHttpServer())
      .post("/deployments")
      .send({ padding: "x".repeat(200_000) })
      .expect(413);
  });

  it("publishes metadata and verifies it by fetching it back", async () => {
    const logo = (await request(t.app.getHttpServer()).post("/assets/logo").attach("file", await testPng(300, 300), "l.png")).body as LogoAsset;
    const published = await request(t.app.getHttpServer())
      .post("/metadata")
      .send({
        mode: "solana-spl",
        network: "solana-local",
        logoAssetId: logo.id,
        name: "Verify Me",
        symbol: "VME",
        description: "A test token",
        website: "https://example.com",
        twitter: "",
        telegram: "",
      })
      .expect(201);
    const metadata = published.body as PublishedMetadata;
    expect(metadata).toMatchObject({ storage: "local-dev", persistent: false, contentAddressed: false, imageUri: logo.imageUri });
    expect(metadata.document).toMatchObject({ name: "Verify Me", symbol: "VME", image: logo.imageUri, website: "https://example.com" });

    const verification = await request(t.app.getHttpServer()).post("/metadata/verify").send({ uri: metadata.metadataUri }).expect(200);
    const statuses = Object.fromEntries(metadataVerificationSchema.parse(verification.body).checks.map((check) => [check.id, check.status]));
    expect(statuses).toEqual({
      "metadata-reachable": "pass",
      "metadata-valid": "pass",
      "image-reachable": "pass",
      "image-format": "pass",
      "onchain-uri-match": "unknown",
      "persistent-storage": "fail",
    });
  });

  it("refuses to publish mainnet metadata to temporary storage", async () => {
    const logo = (await request(t.app.getHttpServer()).post("/assets/logo").attach("file", await testPng(300, 300), "l.png")).body as LogoAsset;
    const response = await request(t.app.getHttpServer())
      .post("/metadata")
      .send({ mode: "pumpfun", network: "solana-mainnet", logoAssetId: logo.id, name: "Main", symbol: "MAIN", description: "" })
      .expect(422);
    expect(apiErrorSchema.parse(response.body).message).toContain("pinned to IPFS");
  });

  it("never fetches internal addresses when verifying metadata", async () => {
    for (const uri of ["https://127.0.0.1/meta.json", "https://169.254.169.254/latest/meta-data", "https://[::1]/x", "file:///etc/passwd"]) {
      const response = await request(t.app.getHttpServer()).post("/metadata/verify").send({ uri }).expect(200);
      const reachable = metadataVerificationSchema.parse(response.body).checks.find((check) => check.id === "metadata-reachable");
      expect(reachable?.status, uri).toBe("fail");
    }
  });

  it("only lists verified tokens", async () => {
    await t.prisma.token.create({
      data: { family: "solana", network: "solana-local", address: "So11111111111111111111111111111111111111112", name: "Unverified", symbol: "UNV", decimals: 9, source: "platform-deployment" },
    });
    const page = await request(t.app.getHttpServer()).get("/tokens").expect(200);
    expect(page.body).toEqual({ items: [], nextCursor: null });
  });
});

describe("upload rate limiting", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ env: { UPLOAD_RATE_LIMIT_PER_MINUTE: "2" } });
  });
  afterAll(async () => {
    await t.close();
  });

  it("applies the stricter upload limit only to upload routes", async () => {
    await request(t.app.getHttpServer()).post("/assets/logo").expect(400);
    await request(t.app.getHttpServer()).post("/assets/logo").expect(400);
    await request(t.app.getHttpServer()).post("/assets/logo").expect(429);
    await request(t.app.getHttpServer()).get("/tokens").expect(200);
  });
});

describe.skipIf(!hasFixtures)("SPL deployment lifecycle against real programs (LiteSVM)", () => {
  let t: TestApp;
  let rpc: LiteSvmConnection;
  let creator: Keypair;
  let metadata: PublishedMetadata;

  beforeAll(async () => {
    rpc = new LiteSvmConnection();
    await rpc.loadProgram(TOKEN_METADATA_PROGRAM_ID, fixturePath("mpl_token_metadata.so"));
    t = await createTestApp({ solana: rpc.asConnection() });
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    creator = Keypair.generate();
    rpc.airdrop(creator.publicKey, 10_000_000_000n);
    const logo = (await request(t.app.getHttpServer()).post("/assets/logo").attach("file", await testPng(300, 300), "l.png")).body as LogoAsset;
    metadata = (
      await request(t.app.getHttpServer())
        .post("/metadata")
        .send({ mode: "solana-spl", network: "solana-local", logoAssetId: logo.id, name: "Lifecycle", symbol: "LIFE", description: "" })
        .expect(201)
    ).body as PublishedMetadata;
  });

  function config(overrides: Partial<SplTokenConfig> = {}): SplTokenConfig {
    return splTokenConfigSchema.parse({
      mode: "solana-spl",
      network: "solana-local",
      name: "Lifecycle",
      symbol: "LIFE",
      description: "",
      decimals: 6,
      initialSupply: "1000000",
      recipient: creator.publicKey.toBase58(),
      mintAuthority: "retain",
      metadataMutable: false,
      ...overrides,
    });
  }

  async function createDeployment(cfg: SplTokenConfig, idempotencyKey = randomKey()): Promise<Deployment> {
    const response = await request(t.app.getHttpServer())
      .post("/deployments")
      .send({ idempotencyKey, creator: creator.publicKey.toBase58(), config: cfg, metadataId: metadata.id })
      .expect(201);
    return deploymentSchema.parse(response.body);
  }

  /** Stands in for the user's wallet: builds the same transaction the web app would, and signs it. */
  async function signAndSend(cfg: SplTokenConfig) {
    const connection = rpc.asConnection();
    const plan = await planCreateSplToken(connection, { creator: creator.publicKey, config: cfg, metadataUri: metadata.metadataUri });
    const prepared = await buildTransaction(connection, creator.publicKey, plan.instructions);
    const signature = await rpc.signAndSend(prepared.transaction, [creator, plan.mint]);
    return { signature, mint: plan.mint.publicKey.toBase58(), lastValidBlockHeight: prepared.lastValidBlockHeight };
  }

  it("goes from intent to verified token, and only then lists it", async () => {
    const cfg = config();
    const created = await createDeployment(cfg);
    expect(created).toMatchObject({ status: "awaiting-approval", txId: null, metadataUri: metadata.metadataUri, decimals: 6 });

    const sent = await signAndSend(cfg);
    const submitted = await request(t.app.getHttpServer())
      .post(`/deployments/${created.id}/submission`)
      .send({ txId: sent.signature, tokenAddress: sent.mint, lastValidBlockHeight: sent.lastValidBlockHeight })
      .expect(200);
    expect(submitted.body).toMatchObject({ status: "submitted", txId: sent.signature, tokenAddress: sent.mint });

    const verified = deploymentSchema.parse((await request(t.app.getHttpServer()).get(`/deployments/${created.id}`).expect(200)).body);
    expect(verified.status).toBe("completed");
    expect(verified.verification).toMatchObject({
      verified: true,
      details: { name: "Lifecycle", symbol: "LIFE", decimals: "6", metadataUri: metadata.metadataUri, initialSupplyBaseUnits: "1000000000000" },
    });

    const page = await request(t.app.getHttpServer()).get("/tokens").query({ q: "life" }).expect(200);
    const { items } = tokenPageSchema.parse(page.body);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ address: sent.mint, mode: "solana-spl", totalSupply: "1000000000000", source: "platform-deployment" });

    const lookup = await request(t.app.getHttpServer()).get(`/tokens/solana-local/${sent.mint}`).expect(200);
    expect(tokenLookupSchema.parse(lookup.body)).toMatchObject({
      mode: "solana-spl",
      name: "Lifecycle",
      totalSupply: "1000000000000",
      owner: creator.publicKey.toBase58(),
      mintingEnabled: true,
      freezeAuthority: null,
      metadataMutable: false,
      pump: null,
      platformDeploymentId: created.id,
    });

    const history = await request(t.app.getHttpServer()).get("/deployments").query({ creator: creator.publicKey.toBase58() }).expect(200);
    expect(history.body).toHaveLength(1);

    await request(t.app.getHttpServer())
      .post(`/deployments/${created.id}/submission`)
      .send({ txId: (await signAndSend(cfg)).signature, tokenAddress: sent.mint })
      .expect(409);
  });

  it("is idempotent and refuses key reuse for a different request", async () => {
    const cfg = config();
    const key = randomKey();
    const first = await createDeployment(cfg, key);
    const repeat = await request(t.app.getHttpServer())
      .post("/deployments")
      .send({ idempotencyKey: key, creator: creator.publicKey.toBase58(), config: cfg, metadataId: metadata.id })
      .expect(200);
    expect(deploymentSchema.parse(repeat.body).id).toBe(first.id);
    await request(t.app.getHttpServer())
      .post("/deployments")
      .send({ idempotencyKey: key, creator: creator.publicKey.toBase58(), config: config({ initialSupply: "5" }), metadataId: metadata.id })
      .expect(409);
  });

  it("marks a deployment failed when the chain does not match the request", async () => {
    const recorded = await createDeployment(config({ initialSupply: "5" }));
    const sent = await signAndSend(config());
    await request(t.app.getHttpServer())
      .post(`/deployments/${recorded.id}/submission`)
      .send({ txId: sent.signature, tokenAddress: sent.mint })
      .expect(200);
    const checked = (await request(t.app.getHttpServer()).get(`/deployments/${recorded.id}`).expect(200)).body as Deployment;
    expect(checked).toMatchObject({ status: "failed", errorCode: "VERIFICATION_FAILED" });
    expect(checked.verification?.verified).toBe(false);
    expect(tokenPageSchema.parse((await request(t.app.getHttpServer()).get("/tokens").expect(200)).body).items).toEqual([]);
  });

  it("never completes a transaction the network has not seen", async () => {
    const created = await createDeployment(config());
    const ghost = Keypair.generate().publicKey.toBase58();
    const fakeSignature = "5".repeat(88);
    await request(t.app.getHttpServer())
      .post(`/deployments/${created.id}/submission`)
      .send({ txId: fakeSignature, tokenAddress: ghost })
      .expect(200);
    const checked = (await request(t.app.getHttpServer()).get(`/deployments/${created.id}`).expect(200)).body as Deployment;
    expect(checked.status).toBe("submitted");
    expect(checked.lastCheckedAt).not.toBeNull();
  });

  it("lets the background worker finish deployments nobody is watching", async () => {
    const cfg = config();
    const created = await createDeployment(cfg);
    const sent = await signAndSend(cfg);
    await request(t.app.getHttpServer())
      .post(`/deployments/${created.id}/submission`)
      .send({ txId: sent.signature, tokenAddress: sent.mint })
      .expect(200);
    const result = await t.app.get(ReconcileWorker).tick();
    expect(result.deployments).toBe(1);
    const row = await t.prisma.deployment.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.status).toBe("completed");
  });

  it("cancels only before submission", async () => {
    const created = await createDeployment(config());
    await request(t.app.getHttpServer()).post(`/deployments/${created.id}/cancel`).send({ errorCode: "USER_REJECTED" }).expect(200);
    const again = await request(t.app.getHttpServer()).post(`/deployments/${created.id}/cancel`).send({}).expect(200);
    expect(again.body).toMatchObject({ status: "cancelled", errorCode: "USER_REJECTED" });

    const other = await createDeployment(config());
    const sent = await signAndSend(config());
    await request(t.app.getHttpServer()).post(`/deployments/${other.id}/submission`).send({ txId: sent.signature, tokenAddress: sent.mint }).expect(200);
    await request(t.app.getHttpServer()).post(`/deployments/${other.id}/cancel`).send({}).expect(409);
  });

  it("requires metadata for Solana launches and rejects addresses from the wrong chain", async () => {
    await request(t.app.getHttpServer())
      .post("/deployments")
      .send({ idempotencyKey: randomKey(), creator: creator.publicKey.toBase58(), config: config(), metadataId: null })
      .expect(422);
    await request(t.app.getHttpServer())
      .post("/deployments")
      .send({ idempotencyKey: randomKey(), creator: "0x000000000000000000000000000000000000dEaD", config: config(), metadataId: metadata.id })
      .expect(400);
  });

  it("records operations with an independent on-chain status", async () => {
    const sent = await signAndSend(config());
    const key = randomKey();
    const body = {
      idempotencyKey: key,
      type: "mint",
      network: "solana-local",
      wallet: creator.publicKey.toBase58(),
      target: sent.mint,
      txId: sent.signature,
      status: "submitted",
      errorCode: null,
      summary: "Mint 10 LIFE",
    };
    const created = await request(t.app.getHttpServer()).post("/operations").send(body).expect(201);
    expect(operationHistoryItemSchema.parse(created.body)).toMatchObject({ status: "submitted", chainStatus: "success", family: "solana" });

    await request(t.app.getHttpServer()).post("/operations").send({ ...body, status: "completed" }).expect(200);
    await request(t.app.getHttpServer()).post("/operations").send({ ...body, status: "awaiting-approval" }).expect(409);
    await request(t.app.getHttpServer()).post("/operations").send({ ...body, txId: "4".repeat(88) }).expect(409);

    const history = await request(t.app.getHttpServer()).get("/operations").query({ wallet: creator.publicKey.toBase58() }).expect(200);
    const operations = z.array(operationHistoryItemSchema).parse(history.body);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ status: "completed", chainStatus: "success" });
  });
});
