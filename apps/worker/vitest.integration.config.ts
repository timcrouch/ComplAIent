import { defineConfig } from "vitest/config";

// Not merged with baseConfig: mergeConfig would concatenate the unit-test include globs.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.int.test.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
