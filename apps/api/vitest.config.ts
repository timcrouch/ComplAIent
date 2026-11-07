import { baseConfig } from "@isms/tooling/vitest";
import swc from "unplugin-swc";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
  baseConfig,
  defineConfig({
    plugins: [swc.vite({ module: { type: "es6" } })],
    test: { exclude: ["**/*.int.test.ts", "**/node_modules/**"] },
  }),
);
