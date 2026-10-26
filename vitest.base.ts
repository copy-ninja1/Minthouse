import { defaultClientConditions, defaultServerConditions } from "vite";
import { defineConfig } from "vitest/config";

/** Resolves workspace packages from TypeScript source so tests never depend on stale builds. */
export const SOURCE_CONDITION = "@minthouse/source";

export const baseTestConfig = defineConfig({
  resolve: {
    conditions: [SOURCE_CONDITION, ...defaultClientConditions],
  },
  ssr: {
    resolve: {
      conditions: [SOURCE_CONDITION, ...defaultServerConditions],
      externalConditions: [SOURCE_CONDITION],
    },
  },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
    },
  },
});
