import { ConfigError, loadConfig } from "@isms/config";
import { describe, expect, it } from "vitest";
import { testEnv } from "../vitest.config";
import { webEnvSchema } from "../lib/env";
import { appUrl } from "../lib/web-url";

const envWith = (url: string): NodeJS.ProcessEnv => ({
  ...testEnv,
  NODE_ENV: "test",
  WEB_BASE_URL: url,
});

describe("WEB_BASE_URL validation", () => {
  it.each([
    "https://isms.example.com",
    "http://localhost:3000",
    "http://localhost",
    "http://127.0.0.1:3000",
  ])("accepts %s", (url) => {
    expect(loadConfig(webEnvSchema, envWith(url)).WEB_BASE_URL).toBe(url);
  });

  it.each([
    "http://isms.example.com",
    "http://localhost.evil.com",
    "ftp://localhost",
    "not a url",
    "",
  ])("refuses to start with %s", (url) => {
    expect(() => loadConfig(webEnvSchema, envWith(url))).toThrow(ConfigError);
  });
});

describe("appUrl", () => {
  it("works with or without a trailing slash on WEB_BASE_URL", () => {
    for (const base of ["http://localhost:3000", "http://localhost:3000/"]) {
      expect(appUrl("/auth/callback", base).toString()).toBe("http://localhost:3000/auth/callback");
      expect(appUrl("/", base).toString()).toBe("http://localhost:3000/");
    }
  });
});

describe("web configuration surface", () => {
  it("does not ask for OIDC_AUDIENCE (only the API checks the audience)", () => {
    expect(Object.keys(webEnvSchema.shape)).not.toContain("OIDC_AUDIENCE");
  });

  it("accepts exactly the LOG_LEVEL values the shared telemetry config accepts", async () => {
    const { telemetryConfig } = await import("@isms/config");
    const { logLevelSchema } = await import("../lib/log");
    expect(logLevelSchema.shape.LOG_LEVEL.unwrap().options).toEqual(
      telemetryConfig.shape.LOG_LEVEL.unwrap().options,
    );
  });
});
