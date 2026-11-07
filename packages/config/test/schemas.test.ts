import { describe, expect, it } from "vitest";
import {
  aiConfig,
  assertNotMockInProduction,
  demoConfig,
  embeddingsConfig,
  loadConfig,
  storageConfig,
} from "../src/index.js";

const storageEnv = {
  S3_ENDPOINT: "http://localhost:9000",
  S3_BUCKET: "isms-evidence",
  S3_ACCESS_KEY_ID: "test-access",
  S3_SECRET_ACCESS_KEY: "test-secret",
};

describe("aiConfig", () => {
  it("accepts a base64 32-byte AI_SECRETS_KEY and returns a Buffer", () => {
    const key = Buffer.alloc(32, 7);
    const config = loadConfig(aiConfig, { AI_SECRETS_KEY: key.toString("base64") });
    expect(Buffer.isBuffer(config.AI_SECRETS_KEY)).toBe(true);
    expect(config.AI_SECRETS_KEY?.length).toBe(32);
    expect(config.AI_SECRETS_KEY?.equals(key)).toBe(true);
  });

  it("leaves AI_SECRETS_KEY undefined when unset and defaults the provider to openrouter", () => {
    const config = loadConfig(aiConfig, {});
    expect(config.AI_SECRETS_KEY).toBeUndefined();
    expect(config.AI_PROVIDER).toBe("openrouter");
  });

  it.each(["", "abc", Buffer.alloc(31).toString("base64"), Buffer.alloc(33).toString("base64")])(
    "rejects AI_SECRETS_KEY %j with 'must be base64 of exactly 32 bytes'",
    (value) => {
      expect(() => loadConfig(aiConfig, { AI_SECRETS_KEY: value })).toThrow(
        /AI_SECRETS_KEY.*must be base64 of exactly 32 bytes/,
      );
    },
  );

  it("parses AI_ALLOW_NON_EU_ROUTING from 'true'/'false' and defaults it to false", () => {
    expect(loadConfig(aiConfig, { AI_ALLOW_NON_EU_ROUTING: "true" }).AI_ALLOW_NON_EU_ROUTING).toBe(
      true,
    );
    expect(loadConfig(aiConfig, { AI_ALLOW_NON_EU_ROUTING: "false" }).AI_ALLOW_NON_EU_ROUTING).toBe(
      false,
    );
    expect(loadConfig(aiConfig, {}).AI_ALLOW_NON_EU_ROUTING).toBe(false);
  });

  it("rejects an invalid AI_ALLOW_NON_EU_ROUTING", () => {
    expect(() => loadConfig(aiConfig, { AI_ALLOW_NON_EU_ROUTING: "yes" })).toThrow(
      /AI_ALLOW_NON_EU_ROUTING/,
    );
  });

  it("rejects an unknown AI_PROVIDER", () => {
    expect(() => loadConfig(aiConfig, { AI_PROVIDER: "other" })).toThrow(/AI_PROVIDER/);
  });
});

describe("assertNotMockInProduction", () => {
  it("refuses AI_PROVIDER=mock in production", () => {
    expect(() => {
      assertNotMockInProduction({ AI_PROVIDER: "mock" }, "production");
    }).toThrow(/AI_PROVIDER=mock is not allowed in production/);
  });

  it("refuses AI_ALLOW_NON_EU_ROUTING=true in production", () => {
    expect(() => {
      assertNotMockInProduction(
        { AI_PROVIDER: "openrouter", AI_ALLOW_NON_EU_ROUTING: true },
        "production",
      );
    }).toThrow(/AI_ALLOW_NON_EU_ROUTING=true is not allowed in production/);
  });

  it("allows AI_ALLOW_NON_EU_ROUTING outside production and when it is false", () => {
    expect(() => {
      assertNotMockInProduction(
        { AI_PROVIDER: "openrouter", AI_ALLOW_NON_EU_ROUTING: true },
        "test",
      );
    }).not.toThrow();
    expect(() => {
      assertNotMockInProduction(
        { AI_PROVIDER: "openrouter", AI_ALLOW_NON_EU_ROUTING: false },
        "production",
      );
    }).not.toThrow();
  });

  it("allows mock outside production and openrouter in production", () => {
    expect(() => {
      assertNotMockInProduction({ AI_PROVIDER: "mock" }, "test");
    }).not.toThrow();
    expect(() => {
      assertNotMockInProduction({ AI_PROVIDER: "openrouter" }, "production");
    }).not.toThrow();
  });
});

describe("storageConfig", () => {
  it("parses S3_FORCE_PATH_STYLE 'true' to true and defaults EVIDENCE_MAX_BYTES to 26214400", () => {
    const config = loadConfig(storageConfig, { ...storageEnv, S3_FORCE_PATH_STYLE: "true" });
    expect(config.S3_FORCE_PATH_STYLE).toBe(true);
    expect(config.EVIDENCE_MAX_BYTES).toBe(26_214_400);
    expect(config.S3_REGION).toBe("eu-central-1");
  });

  it("defaults S3_FORCE_PATH_STYLE to false and caps EVIDENCE_MAX_BYTES at 100 MiB", () => {
    expect(loadConfig(storageConfig, storageEnv).S3_FORCE_PATH_STYLE).toBe(false);
    expect(() =>
      loadConfig(storageConfig, { ...storageEnv, EVIDENCE_MAX_BYTES: "104857601" }),
    ).toThrow(/EVIDENCE_MAX_BYTES/);
  });
});

describe("embeddingsConfig", () => {
  it("defaults the cache directory", () => {
    expect(loadConfig(embeddingsConfig, {}).EMBEDDINGS_CACHE_DIR).toBe(".cache/models");
  });
});

describe("demoConfig", () => {
  it("defaults DEMO_TOOLS_ENABLED to false and parses only 'true' or 'false'", () => {
    expect(loadConfig(demoConfig, {}).DEMO_TOOLS_ENABLED).toBe(false);
    expect(loadConfig(demoConfig, { DEMO_TOOLS_ENABLED: "true" }).DEMO_TOOLS_ENABLED).toBe(true);
    expect(loadConfig(demoConfig, { DEMO_TOOLS_ENABLED: "false" }).DEMO_TOOLS_ENABLED).toBe(false);
    expect(() => loadConfig(demoConfig, { DEMO_TOOLS_ENABLED: "yes" })).toThrow(
      /DEMO_TOOLS_ENABLED/,
    );
  });
});
