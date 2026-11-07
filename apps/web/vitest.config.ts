import { fileURLToPath } from "node:url";
import { baseConfig } from "@isms/tooling/vitest";
import { defineConfig, mergeConfig } from "vitest/config";

/** Non-secret placeholders so modules that read configuration can load in unit tests. */
export const testEnv = {
  WEB_BASE_URL: "http://localhost:3000",
  API_BASE_URL: "http://api.test",
  SESSION_SECRET: "unit-test-session-secret-0123456789abcdef",
  OIDC_ISSUER_URL: "http://idp.test/realms/isms",
  OIDC_CLIENT_ID: "isms-web",
  OIDC_CLIENT_SECRET: "unit-test-client-secret",
  REDIS_URL: "redis://redis.test:6379",
  LOG_LEVEL: "fatal",
  // Small, so the upload tests can go past it.
  EVIDENCE_MAX_BYTES: "4096",
};

export const serverOnlyAlias = {
  // `server-only` throws outside the react-server condition that Next.js applies.
  "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
};

export default mergeConfig(
  baseConfig,
  defineConfig({
    resolve: { alias: serverOnlyAlias },
    test: {
      include: ["test/**/*.test.tsx"],
      exclude: ["**/*.int.test.ts", "**/node_modules/**"],
      env: testEnv,
    },
  }),
);
