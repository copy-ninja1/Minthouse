import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_TEST_DATABASE_URL = "postgresql://minthouse@127.0.0.1:54329/minthouse_test";

/**
 * Applies migrations to a dedicated test database. The tests truncate its
 * tables, so it must never point at a database holding real data.
 */
export default function setup(project: TestProject): void {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
  if (!/_test(\?|$)/.test(databaseUrl)) {
    throw new Error("TEST_DATABASE_URL must name a database ending in _test; the API tests delete all rows in it.");
  }
  try {
    execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      cwd: API_ROOT,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    });
  } catch (error) {
    const output = error instanceof Error && "stderr" in error ? String(error.stderr) : String(error);
    throw new Error(
      `Could not migrate the test database at ${databaseUrl}.\n` +
        "Start the local database with `pnpm db:local:start` (scripts/local-postgres.sh) or set TEST_DATABASE_URL.\n" +
        output,
      { cause: error },
    );
  }
  project.provide("databaseUrl", databaseUrl);
}
