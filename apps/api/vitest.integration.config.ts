import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// Not merged with baseConfig: mergeConfig would concatenate the unit-test include globs.
export default defineConfig({
  plugins: [swc.vite({ module: { type: "es6" } })],
  test: {
    environment: "node",
    include: ["test/**/*.int.test.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
