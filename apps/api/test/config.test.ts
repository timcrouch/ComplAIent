import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadAppConfig } from "../src/config.js";

const ENV = {
  DATABASE_URL: "postgresql://isms_app:x@localhost:5432/isms",
  REDIS_URL: "redis://localhost:6379",
  OIDC_ISSUER_URL: "http://localhost:8080/realms/isms",
  OIDC_AUDIENCE: "isms-api",
  S3_ENDPOINT: "http://localhost:9000",
  S3_BUCKET: "isms-evidence",
  // Placeholders: the config only checks they are present.
  S3_ACCESS_KEY_ID: "test-access-key-id",
  S3_SECRET_ACCESS_KEY: "test-secret-access-key",
};

describe("API configuration", () => {
  it("loads the AI provider and secrets key", () => {
    const secretsKey = randomBytes(32);
    const config = loadAppConfig({
      ...ENV,
      AI_PROVIDER: "mock",
      AI_SECRETS_KEY: secretsKey.toString("base64"),
    });
    expect(config.AI_PROVIDER).toBe("mock");
    expect(config.AI_SECRETS_KEY?.equals(secretsKey)).toBe(true);
    const defaults = loadAppConfig(ENV);
    expect(defaults.AI_PROVIDER).toBe("openrouter");
    expect(defaults.AI_SECRETS_KEY).toBeUndefined();
  });

  it("requires evidence storage (P3-R15) and defaults the upload limit to 25 MiB", () => {
    const withoutStorage = Object.fromEntries(
      Object.entries(ENV).filter(([name]) => name !== "S3_ENDPOINT"),
    );
    expect(() => loadAppConfig(withoutStorage)).toThrow(/S3_ENDPOINT/);
    const config = loadAppConfig(ENV);
    expect(config.EVIDENCE_MAX_BYTES).toBe(26_214_400);
    expect(config.S3_FORCE_PATH_STYLE).toBe(false);
  });

  it("refuses the mock AI provider in production at startup", () => {
    expect(() => loadAppConfig({ ...ENV, NODE_ENV: "production", AI_PROVIDER: "mock" })).toThrow(
      /AI_PROVIDER=mock/,
    );
    expect(loadAppConfig({ ...ENV, NODE_ENV: "production" }).AI_PROVIDER).toBe("openrouter");
  });

  it("refuses non-EU AI routing in production at startup, and defaults it to off", () => {
    expect(() =>
      loadAppConfig({ ...ENV, NODE_ENV: "production", AI_ALLOW_NON_EU_ROUTING: "true" }),
    ).toThrow(/AI_ALLOW_NON_EU_ROUTING=true/);
    expect(loadAppConfig(ENV).AI_ALLOW_NON_EU_ROUTING).toBe(false);
    expect(loadAppConfig({ ...ENV, AI_ALLOW_NON_EU_ROUTING: "true" }).AI_ALLOW_NON_EU_ROUTING).toBe(
      true,
    );
  });

  describe("demo mode (spec §5.1)", () => {
    const OWNER_URL = "postgresql://isms_owner:x@localhost:5432/isms";
    const BOOTSTRAP = "admin@example.test";

    it("is off by default: config.demo is null", () => {
      expect(loadAppConfig(ENV).demo).toBeNull();
    });

    it("on: requires BOOTSTRAP_ADMIN_EMAIL, naming it", () => {
      expect(() =>
        loadAppConfig({ ...ENV, DEMO_TOOLS_ENABLED: "true", DATABASE_OWNER_URL: OWNER_URL }),
      ).toThrow(/BOOTSTRAP_ADMIN_EMAIL: is required when DEMO_TOOLS_ENABLED=true/);
    });

    it("on: requires DATABASE_OWNER_URL, naming it", () => {
      expect(() =>
        loadAppConfig({ ...ENV, DEMO_TOOLS_ENABLED: "true", BOOTSTRAP_ADMIN_EMAIL: BOOTSTRAP }),
      ).toThrow(/DATABASE_OWNER_URL: is required when DEMO_TOOLS_ENABLED=true/);
    });

    it("on: reports both missing settings at once", () => {
      let problems: readonly string[] = [];
      try {
        loadAppConfig({ ...ENV, DEMO_TOOLS_ENABLED: "true" });
      } catch (err) {
        problems = (err as { problems: readonly string[] }).problems;
      }
      expect(problems.map((p) => p.split(":")[0]).sort()).toEqual([
        "BOOTSTRAP_ADMIN_EMAIL",
        "DATABASE_OWNER_URL",
      ]);
    });

    it("on: rejects a malformed DATABASE_OWNER_URL without echoing it", () => {
      expect(() =>
        loadAppConfig({
          ...ENV,
          DEMO_TOOLS_ENABLED: "true",
          BOOTSTRAP_ADMIN_EMAIL: BOOTSTRAP,
          DATABASE_OWNER_URL: "not a url secret-ish",
        }),
      ).toThrow(/DATABASE_OWNER_URL: has an invalid format/);
    });

    it("on with both: config.demo carries the owner URL", () => {
      const config = loadAppConfig({
        ...ENV,
        DEMO_TOOLS_ENABLED: "true",
        BOOTSTRAP_ADMIN_EMAIL: BOOTSTRAP,
        DATABASE_OWNER_URL: OWNER_URL,
      });
      expect(config.demo).toEqual({ ownerUrl: OWNER_URL });
      expect(config.DEMO_TOOLS_ENABLED).toBe(true);
    });

    it("off: never reads DATABASE_OWNER_URL, even when it is set (or malformed)", () => {
      const reads: string[] = [];
      const target: NodeJS.ProcessEnv = { ...ENV, DATABASE_OWNER_URL: "not a url" };
      const env = new Proxy(target, {
        get(target, key, receiver) {
          if (typeof key === "string") reads.push(key);
          return Reflect.get(target, key, receiver) as unknown;
        },
      });
      const config = loadAppConfig(env);
      expect(config.demo).toBeNull();
      expect(reads).not.toContain("DATABASE_OWNER_URL");
      expect(JSON.stringify(config)).not.toContain("not a url");
      expect(Object.keys(config)).not.toContain("DATABASE_OWNER_URL");
    });
  });
});
