import swc from "unplugin-swc";
import { mergeConfig } from "vitest/config";
import { baseTestConfig } from "../../vitest.base.js";

export default mergeConfig(baseTestConfig, {
  // Nest's dependency injection needs decorator metadata, which esbuild does not emit.
  plugins: [swc.vite({ module: { type: "es6" } })],
  test: {
    testTimeout: 30_000,
    hookTimeout: 60_000,
    globalSetup: ["./test/global-setup.ts"],
    fileParallelism: false,
  },
});
