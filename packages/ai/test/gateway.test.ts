import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createGateway } from "../src/gateway.js";
import { createMockProvider } from "../src/mock-provider.js";
import { ProviderError } from "../src/provider.js";
import { sealSecret } from "../src/secret-box.js";
import { defaultAiSettings, type AiSettingsRow } from "../src/store.js";
import { createMemoryAiStore } from "../src/testing.js";
import { completion, fakeFetch, json } from "./helpers.js";

const SECRETS_KEY = randomBytes(32);
const API_KEY = "sk-or-test-only-gateway-1234";

function readySettings(overrides: Partial<AiSettingsRow> = {}): AiSettingsRow {
  return {
    ...defaultAiSettings(),
    enabled: true,
    sealedKey: sealSecret(API_KEY, SECRETS_KEY),
    keyLast4: "1234",
    keySetById: "00000000-0000-7000-8000-000000000001",
    keySetAt: new Date(),
    models: { conversation: "vendor/chat", controls: "vendor/controls" },
    ...overrides,
  };
}

const CALL = {
  system: "s",
  messages: [{ role: "user" as const, content: "hello" }],
  schema: z.object({ ok: z.boolean() }).strict(),
  schemaName: "connection_test",
  maxTokens: 50,
  timeoutMs: 1000,
  actorUserId: null,
};

describe("gateway", () => {
  it("refuses without calling when not ready", async () => {
    const providerFactory = vi.fn();
    const store = createMemoryAiStore(readySettings({ enabled: false }));
    const gateway = createGateway({
      store,
      secretsKey: SECRETS_KEY,
      provider: "mock",
      providerFactory,
    });
    expect(await gateway.readiness("concern_turn")).toEqual({ ready: false, reason: "disabled" });
    expect(await gateway.run("concern_turn", CALL)).toEqual({ ok: false, reason: "disabled" });
    expect(providerFactory).not.toHaveBeenCalled();
    expect(store.interactions).toHaveLength(0);
  });

  it("runs with the purpose's model through OpenRouter with the opened key and EU routing", async () => {
    const { fetchImpl, calls } = fakeFetch(() => completion('{"ok":true}'));
    const store = createMemoryAiStore(readySettings());
    const gateway = createGateway({
      store,
      secretsKey: SECRETS_KEY,
      provider: "openrouter",
      fetchImpl,
    });
    const result = await gateway.run("control_suggestion", CALL);
    expect(result).toMatchObject({ ok: true, value: { ok: true } });
    expect(calls[0]?.url).toBe("https://eu.openrouter.ai/api/v1/chat/completions");
    expect(calls[0]?.body).toMatchObject({ model: "vendor/controls" });
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe(`Bearer ${API_KEY}`);
    expect(JSON.stringify(store.interactions)).not.toContain(API_KEY);
  });

  it("reports keyUnreadable when the secrets key changed", async () => {
    const store = createMemoryAiStore(readySettings());
    const gateway = createGateway({ store, secretsKey: randomBytes(32), provider: "mock" });
    expect(await gateway.run("concern_turn", CALL)).toEqual({ ok: false, reason: "keyUnreadable" });
  });

  it("passes settings and the opened key to a provider factory", async () => {
    const providerFactory = vi.fn(() => createMockProvider());
    const store = createMemoryAiStore(readySettings());
    const gateway = createGateway({
      store,
      secretsKey: SECRETS_KEY,
      provider: "openrouter",
      providerFactory,
    });
    await gateway.run("concern_turn", CALL);
    expect(providerFactory).toHaveBeenCalledWith(
      expect.objectContaining({ euOnly: true }),
      API_KEY,
    );
  });

  it("sets an outcome through the store", async () => {
    const store = createMemoryAiStore(readySettings());
    const gateway = createGateway({ store, secretsKey: SECRETS_KEY, provider: "mock" });
    const result = await gateway.run("concern_turn", CALL);
    await gateway.setOutcome(result.ok ? result.interactionId : "", "accepted");
    expect(store.interactions[0]?.outcome).toBe("accepted");
  });

  it("the memory store sets a discarded count", async () => {
    const store = createMemoryAiStore(readySettings());
    const gateway = createGateway({ store, secretsKey: SECRETS_KEY, provider: "mock" });
    const result = await gateway.run("concern_turn", CALL);
    await store.setDiscardedCount(result.ok ? result.interactionId : "", 3);
    expect(store.interactions[0]?.discardedCount).toBe(3);
    await expect(store.setDiscardedCount("nope", 1)).rejects.toThrow();
  });

  it("lists models from the provider", async () => {
    const gateway = createGateway({
      store: createMemoryAiStore(readySettings()),
      secretsKey: SECRETS_KEY,
      provider: "mock",
    });
    expect(await gateway.listModels()).toEqual([{ id: "mock/isms-test", name: "Test model" }]);
  });

  describe("test()", () => {
    it("uses the conversation model and records a connection_test interaction", async () => {
      const store = createMemoryAiStore(readySettings({ enabled: false }));
      const gateway = createGateway({ store, secretsKey: SECRETS_KEY, provider: "mock" });
      expect(await gateway.test({ actorUserId: "u-1" })).toEqual({
        ok: true,
        model: "vendor/chat",
      });
      expect(store.interactions).toHaveLength(1);
      expect(store.interactions[0]).toMatchObject({
        purpose: "connection_test",
        status: "ok",
        actorUserId: "u-1",
        request: { messages: [{ role: "user", content: 'Reply with {"ok":true}.' }] },
      });
    });

    it("falls back to the first listed model", async () => {
      const store = createMemoryAiStore(readySettings({ models: {} }));
      const gateway = createGateway({ store, secretsKey: SECRETS_KEY, provider: "mock" });
      expect(await gateway.readiness("connection_test")).toEqual({ ready: true, model: null });
      expect(await gateway.test()).toEqual({ ok: true, model: "mock/isms-test" });
    });

    it("reports a readiness reason without calling", async () => {
      const store = createMemoryAiStore(readySettings({ sealedKey: null }));
      const gateway = createGateway({ store, secretsKey: SECRETS_KEY, provider: "mock" });
      expect(await gateway.test()).toEqual({ ok: false, reason: "noKey" });
      const noSecrets = createGateway({
        store: createMemoryAiStore(readySettings()),
        secretsKey: undefined,
        provider: "mock",
      });
      expect(await noSecrets.test()).toEqual({ ok: false, reason: "secretsKeyMissing" });
    });

    it.each([
      "auth",
      "regionNotAllowed",
      "noEndpoint",
      "rateLimited",
      "timeout",
      "unavailable",
    ] as const)("maps a provider error %s to its reason", async (kind) => {
      const store = createMemoryAiStore(readySettings());
      const gateway = createGateway({
        store,
        secretsKey: SECRETS_KEY,
        provider: "mock",
        providerFactory: () => createMockProvider({ script: () => new ProviderError(kind) }),
      });
      expect(await gateway.test()).toEqual({ ok: false, reason: kind });
    });

    it("maps invalid output to unavailable", async () => {
      const gateway = createGateway({
        store: createMemoryAiStore(readySettings()),
        secretsKey: SECRETS_KEY,
        provider: "mock",
        providerFactory: () => createMockProvider({ script: () => "not json" }),
      });
      expect(await gateway.test()).toEqual({ ok: false, reason: "unavailable" });
    });

    it("maps a rejected key while listing models to auth", async () => {
      const { fetchImpl } = fakeFetch(() => json({}, 401));
      const gateway = createGateway({
        store: createMemoryAiStore(readySettings({ models: {} })),
        secretsKey: SECRETS_KEY,
        provider: "openrouter",
        fetchImpl,
      });
      expect(await gateway.test()).toEqual({ ok: false, reason: "auth" });
    });

    it("reports noEndpoint when no model is listed", async () => {
      const { fetchImpl } = fakeFetch(() => json({ data: [] }));
      const gateway = createGateway({
        store: createMemoryAiStore(readySettings({ models: {} })),
        secretsKey: SECRETS_KEY,
        provider: "openrouter",
        fetchImpl,
      });
      expect(await gateway.test()).toEqual({ ok: false, reason: "noEndpoint" });
    });
  });
});
