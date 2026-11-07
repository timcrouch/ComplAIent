import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ProviderError, type AiProvider, type CompletionRequest } from "../src/provider.js";
import {
  assertStrictJsonSchema,
  runStructured,
  toStrictJsonSchema,
  type StructuredCall,
} from "../src/structured.js";
import { createMemoryAiStore } from "../src/testing.js";

const ANY_ID: unknown = expect.any(String);
const SECRET_PROMPT = "my confidential concern about payroll";
const SCHEMA = z.object({ answer: z.string(), score: z.number().int().nullable() }).strict();

function scriptedProvider(
  replies: (string | ProviderError)[],
): AiProvider & { requests: CompletionRequest[] } {
  const requests: CompletionRequest[] = [];
  return {
    name: "scripted",
    routing: { baseUrl: "https://eu.openrouter.ai/api/v1", zdr: true, dataCollection: "deny" },
    requests,
    complete(r) {
      requests.push(r);
      const next = replies.shift();
      if (next === undefined) throw new Error("no reply scripted");
      if (next instanceof ProviderError) return Promise.reject(next);
      return Promise.resolve({ content: next, model: r.model, provider: "EuHost" });
    },
    listModels: () => Promise.resolve([]),
  };
}

function call(): StructuredCall<z.infer<typeof SCHEMA>> {
  return {
    purpose: "concern_turn",
    model: "vendor/a",
    system: "System prompt",
    messages: [{ role: "user", content: SECRET_PROMPT }],
    schema: SCHEMA,
    schemaName: "concern_turn",
    maxTokens: 200,
    timeoutMs: 1000,
    actorUserId: "00000000-0000-7000-8000-000000000001",
    object: { type: "ConcernConversation", id: "c-1" },
  };
}

describe("toStrictJsonSchema", () => {
  it("produces a strict schema: no $schema, additionalProperties false and every property required", () => {
    const schema = toStrictJsonSchema(
      z
        .object({ a: z.string(), b: z.array(z.object({ c: z.string().nullable() }).strict()) })
        .strict(),
    );
    expect(schema).toEqual({
      type: "object",
      properties: {
        a: { type: "string" },
        b: {
          type: "array",
          items: {
            type: "object",
            properties: { c: { type: ["string", "null"] } },
            required: ["c"],
            additionalProperties: false,
          },
        },
      },
      required: ["a", "b"],
      additionalProperties: false,
    });
  });

  it("rejects optional properties (use nullable instead)", () => {
    expect(() => toStrictJsonSchema(z.object({ a: z.string().optional() }).strict())).toThrow(
      /nullable/,
    );
  });
});

describe("strict schema check", () => {
  it("rejects a record (an object schema without properties) with a programming error", () => {
    expect(() =>
      toStrictJsonSchema(z.object({ m: z.record(z.string(), z.string()) }).strict()),
    ).toThrow(/\$\.m .*must declare its properties/);
  });

  it("rejects a top-level object without properties", () => {
    expect(() => {
      assertStrictJsonSchema({ type: "object" });
    }).toThrow(/\$ .*must declare its properties/);
    expect(() => {
      assertStrictJsonSchema({ type: ["object", "null"], additionalProperties: false });
    }).toThrow(/must declare its properties/);
  });

  it("rejects a nested object whose additionalProperties is a sub-schema", () => {
    expect(() => {
      assertStrictJsonSchema({
        anyOf: [{ additionalProperties: { type: "string" } }],
      });
    }).toThrow(/\$\.anyOf\[0\] .*must declare its properties/);
    expect(() => {
      assertStrictJsonSchema({
        type: "object",
        properties: { a: { type: "string" } },
        required: ["a"],
        additionalProperties: { type: "string" },
      });
    }).toThrow(/must not allow additional properties/);
  });

  it("walks not and $defs sub-schemas", () => {
    expect(() => {
      assertStrictJsonSchema({ not: { type: "object" } });
    }).toThrow(/\$\.not /);
    expect(() => {
      assertStrictJsonSchema({ $defs: { Item: { type: "object" } } });
    }).toThrow(/\$\.Item /);
  });

  it("accepts a closed empty object", () => {
    expect(toStrictJsonSchema(z.object({}).strict())).toEqual({
      type: "object",
      properties: {},
      additionalProperties: false,
    });
  });
});

describe("runStructured", () => {
  it("returns the parsed value and records one ok interaction", async () => {
    const store = createMemoryAiStore();
    const provider = scriptedProvider(['{"answer":"yes","score":3}']);
    const result = await runStructured({ provider, store }, call());

    expect(result).toEqual({ ok: true, value: { answer: "yes", score: 3 }, interactionId: ANY_ID });
    expect(store.interactions).toHaveLength(1);
    expect(store.interactions[0]).toMatchObject({
      id: result.interactionId,
      purpose: "concern_turn",
      provider: "scripted",
      model: "vendor/a",
      routing: {
        baseUrl: "https://eu.openrouter.ai/api/v1",
        zdr: true,
        dataCollection: "deny",
        upstream: "EuHost",
      },
      request: { system: "System prompt", messages: [{ role: "user", content: SECRET_PROMPT }] },
      response: '{"answer":"yes","score":3}',
      status: "ok",
      attempts: 1,
      actorUserId: "00000000-0000-7000-8000-000000000001",
      objectType: "ConcernConversation",
      objectId: "c-1",
    });
    expect(provider.requests[0]).toMatchObject({
      schemaName: "concern_turn",
      jsonSchema: toStrictJsonSchema(SCHEMA),
      maxTokens: 200,
      timeoutMs: 1000,
    });
  });

  it("retries once on invalid output and records one interaction with attempts 2", async () => {
    const store = createMemoryAiStore();
    const provider = scriptedProvider(["not json", '{"answer":"ok","score":null}']);
    const result = await runStructured({ provider, store }, call());

    expect(result).toMatchObject({ ok: true, value: { answer: "ok", score: null } });
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1]).toEqual(provider.requests[0]);
    expect(store.interactions).toHaveLength(1);
    expect(store.interactions[0]).toMatchObject({ status: "ok", attempts: 2 });
  });

  it("treats a schema mismatch as invalid output", async () => {
    const store = createMemoryAiStore();
    const provider = scriptedProvider(['{"answer":1}', '{"answer":"x","score":1,"extra":true}']);
    const result = await runStructured({ provider, store }, call());
    expect(result).toEqual({ ok: false, reason: "invalidOutput", interactionId: ANY_ID });
  });

  it("returns invalidOutput after two invalid outputs", async () => {
    const store = createMemoryAiStore();
    const provider = scriptedProvider(["nope", "still nope"]);
    const result = await runStructured({ provider, store }, call());

    expect(result).toEqual({ ok: false, reason: "invalidOutput", interactionId: ANY_ID });
    expect(store.interactions).toHaveLength(1);
    expect(store.interactions[0]).toMatchObject({
      status: "invalid_output",
      attempts: 2,
      response: "still nope",
    });
  });

  it("does not retry a ProviderError", async () => {
    const store = createMemoryAiStore();
    const provider = scriptedProvider([
      new ProviderError("rateLimited"),
      '{"answer":"x","score":1}',
    ]);
    const result = await runStructured({ provider, store }, call());

    expect(result).toEqual({
      ok: false,
      reason: "providerError",
      providerKind: "rateLimited",
      interactionId: ANY_ID,
    });
    expect(provider.requests).toHaveLength(1);
    expect(store.interactions[0]).toMatchObject({
      status: "provider_error",
      attempts: 1,
      response: null,
    });
  });

  it("a provider error on the retry keeps the first raw response", async () => {
    const store = createMemoryAiStore();
    const provider = scriptedProvider(["garbage", new ProviderError("timeout")]);
    const result = await runStructured({ provider, store }, call());
    expect(result).toMatchObject({ ok: false, reason: "providerError", providerKind: "timeout" });
    expect(store.interactions[0]).toMatchObject({
      status: "provider_error",
      attempts: 2,
      response: "garbage",
    });
  });

  it("never passes prompt text to the logger", async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const store = createMemoryAiStore();
    const replies = ["garbage reply text", '{"answer":"secret answer text","score":1}'];
    await runStructured({ provider: scriptedProvider(replies), store, logger }, call());
    await runStructured(
      { provider: scriptedProvider([new ProviderError("auth")]), store, logger },
      call(),
    );
    const logged = JSON.stringify([...logger.info.mock.calls, ...logger.warn.mock.calls]);
    expect(logger.info.mock.calls.length + logger.warn.mock.calls.length).toBeGreaterThan(0);
    for (const text of [
      SECRET_PROMPT,
      "System prompt",
      "garbage reply text",
      "secret answer text",
    ]) {
      expect(logged).not.toContain(text);
    }
    expect(logged).toContain("concern_turn");
  });
});
