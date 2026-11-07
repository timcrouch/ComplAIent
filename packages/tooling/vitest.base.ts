import { defineConfig } from "vitest/config";

export const baseConfig = defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    passWithNoTests: false,
  },
});
