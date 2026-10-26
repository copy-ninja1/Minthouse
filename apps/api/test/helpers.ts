import { mkdtemp, rm } from "node:fs/promises";
import { type AddressInfo, createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { Test, type TestingModuleBuilder } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Connection } from "@solana/web3.js";
import sharp from "sharp";
import { inject } from "vitest";
import type { ApiEnv } from "@minthouse/config";
import type { NetworkId } from "@minthouse/shared";
import { AppModule } from "../src/app.module.js";
import { configureApp } from "../src/bootstrap.js";
import { ChainClientsService } from "../src/chains/chain-clients.service.js";
import { API_ENV, loadApiEnv } from "../src/config/env.js";
import { PrismaService } from "../src/prisma/prisma.service.js";

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

/** Chain clients whose Solana connection is an in-process LiteSVM running real program binaries. */
export class TestChainClients extends ChainClientsService {
  constructor(
    env: ApiEnv,
    private readonly connection: Connection,
  ) {
    super(env);
  }

  override solana(network: NetworkId): Connection {
    this.assertEnabled(network);
    return this.connection;
  }
}

export type TestApp = {
  app: NestExpressApplication;
  env: ApiEnv;
  baseUrl: string;
  prisma: PrismaService;
  close: () => Promise<void>;
};

export async function createTestApp(options: {
  env?: Record<string, string>;
  solana?: Connection;
  configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
} = {}): Promise<TestApp> {
  const port = await freePort();
  const storageDir = await mkdtemp(path.join(tmpdir(), "minthouse-api-test-"));
  const env = loadApiEnv({
    NODE_ENV: "test",
    LOG_LEVEL: "fatal",
    DATABASE_URL: inject("databaseUrl"),
    PUBLIC_API_URL: `http://127.0.0.1:${port}`,
    STORAGE_PROVIDER: "local",
    LOCAL_STORAGE_DIR: storageDir,
    ENABLED_NETWORKS: "solana-local,bsc-local,solana-mainnet",
    RECONCILE_INTERVAL_MS: "0",
    RATE_LIMIT_PER_MINUTE: "1000",
    UPLOAD_RATE_LIMIT_PER_MINUTE: "1000",
    ...options.env,
  });

  let builder = Test.createTestingModule({ imports: [AppModule.forRoot(env)] });
  const { solana } = options;
  if (solana) {
    builder = builder.overrideProvider(ChainClientsService).useFactory({
      factory: (apiEnv: ApiEnv) => new TestChainClients(apiEnv, solana),
      inject: [API_ENV],
    });
  }
  if (options.configure) {
    builder = options.configure(builder);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  configureApp(app, env);
  await app.listen(port, "127.0.0.1");

  return {
    app,
    env,
    baseUrl: env.PUBLIC_API_URL,
    prisma: app.get(PrismaService),
    close: async () => {
      await app.close();
      await rm(storageDir, { recursive: true, force: true });
    },
  };
}

export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "Token", "Deployment", "Operation", "MetadataAsset" CASCADE');
}

/** A real PNG with some structure so compression behaves like a logo. */
export function testPng(width: number, height: number, hue = 120): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="hsl(${hue},70%,45%)"/>
    <circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 3}" fill="white"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export function randomKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
