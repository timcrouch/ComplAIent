import { defineConfig } from "vitest/config";
import { serverOnlyAlias } from "./vitest.config.js";

// Not merged with baseConfig: mergeConfig would concatenate the unit-test include globs.
export default defineConfig({
  resolve: { alias: serverOnlyAlias },
  test: {
    environment: "node",
    include: ["test/**/*.int.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    env: { LOG_LEVEL: "fatal" },
  },
});
