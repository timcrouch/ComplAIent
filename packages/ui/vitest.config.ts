import { mergeConfig } from "vitest/config";
import { baseConfig } from "@isms/tooling/vitest";

export default mergeConfig(baseConfig, {
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    setupFiles: ["test/setup.ts"],
  },
});
