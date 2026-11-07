import { baseConfig } from "@isms/tooling/vitest";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
  baseConfig,
  defineConfig({ test: { exclude: ["**/*.int.test.ts", "**/node_modules/**"] } }),
);
