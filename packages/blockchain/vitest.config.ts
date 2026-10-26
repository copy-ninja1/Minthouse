import { mergeConfig } from "vitest/config";
import { baseTestConfig } from "../../vitest.base.js";

export default mergeConfig(baseTestConfig, {
  test: {
    testTimeout: 30_000,
  },
});
