import { describe, expect, it } from "vitest";
import { createOpenRouterProvider } from "../src/openrouter.js";
import { ProviderError } from "../src/provider.js";
import { completion, fakeFetch, json, REQUEST } from "./helpers.js";

const API_KEY = "sk-or-test-only-0000";

async function kindOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ProviderError) return error.kind;
    throw error;
  }
  throw new Error("expected a ProviderError");
}

describe("OpenRouter provider", () => {
  it("uses the EU base URL when euOnly and always sends zdr and data_collection deny", async () => {
    const { fetchImpl, calls } = fakeFetch(() => completion('{"ok":true}'));
    const provider = createOpenRouterProvider({
      apiKey: API_KEY,
      euOnly: true,
      fetchImpl,
    });
    const result = await provider.complete(REQUEST);

    expect(result).toEqual({
      content: '{"ok":true}',
      model: "vendor/model-a",
      provider: "SomeEuHost",
    });
    expect(calls[0]?.url).toBe("https://eu.openrouter.ai/api/v1/chat/completions");
    expect(provider.routing).toEqual({
      baseUrl: "https://eu.openrouter.ai/api/v1",
      zdr: true,
      dataCollection: "deny",
    });
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${API_KEY}`);
    expect(headers.get("x-title")).toBe("ISMS");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.body).toEqual({
      model: "vendor/model-a",
      messages: [
        { role: "system", content: "You are a test." },
        { role: "user", content: "Hello there" },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "connection_test",
          strict: true,
          schema: { type: "object" },
        },
      },
      // No temperature: ZDR endpoints of current models reject it, and require_parameters would
      // then filter out every endpoint.
      max_tokens: 100,
      provider: {
        zdr: true,
        data_collection: "deny",
        require_parameters: true,
      },
    });
  });

  it("uses the global base URL when euOnly is off, still with zdr and deny", async () => {
    const { fetchImpl, calls } = fakeFetch(() => completion("{}"));
    await createOpenRouterProvider({
      apiKey: API_KEY,
      euOnly: false,
      fetchImpl,
    }).complete(REQUEST);
    expect(calls[0]?.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(calls[0]?.body).toMatchObject({
      provider: {
        zdr: true,
        data_collection: "deny",
        require_parameters: true,
      },
    });
  });

  it.each([
    [401, "auth"],
    [403, "auth"],
    [404, "noEndpoint"],
    [429, "rateLimited"],
    [502, "unavailable"],
    [500, "unavailable"],
  ])("maps %i to %s", async (status, kind) => {
    const { fetchImpl } = fakeFetch(() => json({ error: { code: status, message: "x" } }, status));
    const provider = createOpenRouterProvider({
      apiKey: API_KEY,
      euOnly: true,
      fetchImpl,
    });
    expect(await kindOf(provider.complete(REQUEST))).toBe(kind);
  });

  const REGIONAL =
    "Regional routing requires a Business or Enterprise plan. Upgrade at https://openrouter.ai/settings/manage-plan, then send requests to eu.openrouter.ai or us.openrouter.ai.";

  it("maps a 403 about regional routing to regionNotAllowed, not auth", async () => {
    const { fetchImpl } = fakeFetch(() => json({ error: { message: REGIONAL, code: 403 } }, 403));
    const provider = createOpenRouterProvider({
      apiKey: API_KEY,
      euOnly: true,
      fetchImpl,
    });
    expect(await kindOf(provider.complete(REQUEST))).toBe("regionNotAllowed");
    expect(await kindOf(provider.listModels())).toBe("regionNotAllowed");
  });

  it("matches the regional message case-insensitively but only on a 403", async () => {
    const upper = fakeFetch(() => json({ error: { message: "REGIONAL ROUTING", code: 403 } }, 403));
    const a = createOpenRouterProvider({
      apiKey: API_KEY,
      euOnly: true,
      fetchImpl: upper.fetchImpl,
    });
    expect(await kindOf(a.complete(REQUEST))).toBe("regionNotAllowed");
    const other = fakeFetch(() => json({ error: { message: REGIONAL, code: 500 } }, 500));
    const b = createOpenRouterProvider({
      apiKey: API_KEY,
      euOnly: true,
      fetchImpl: other.fetchImpl,
    });
    expect(await kindOf(b.complete(REQUEST))).toBe("unavailable");
  });

  it("maps a regional error object inside a 200 response to regionNotAllowed", async () => {
    const { fetchImpl } = fakeFetch(() => json({ error: { code: 403, message: REGIONAL } }));
    const provider = createOpenRouterProvider({
      apiKey: API_KEY,
      euOnly: true,
      fetchImpl,
    });
    expect(await kindOf(provider.complete(REQUEST))).toBe("regionNotAllowed");
  });

  it("maps a 400 'No endpoints found matching your data policy' to noEndpoint", async () => {
    const { fetchImpl } = fakeFetch(() =>
      json(
        {
          error: {
            code: 400,
            message: "No endpoints found matching your data policy",
          },
        },
        400,
      ),
    );
    const provider = createOpenRouterProvider({
      apiKey: API_KEY,
      euOnly: true,
      fetchImpl,
    });
    expect(await kindOf(provider.complete(REQUEST))).toBe("noEndpoint");
  });

  it("maps an error object inside a 200 response by its code", async () => {
    const { fetchImpl } = fakeFetch(() => json({ error: { code: 429, message: "slow down" } }));
    const provider = createOpenRouterProvider({
      apiKey: API_KEY,
      euOnly: true,
      fetchImpl,
    });
    expect(await kindOf(provider.complete(REQUEST))).toBe("rateLimited");
  });

  it("maps a response without content to unavailable", async () => {
    const { fetchImpl } = fakeFetch(() => json({ choices: [] }));
    const provider = createOpenRouterProvider({
      apiKey: API_KEY,
      euOnly: true,
      fetchImpl,
    });
    expect(await kindOf(provider.complete(REQUEST))).toBe("unavailable");
  });

  it("maps a network failure to unavailable", async () => {
    const fetchImpl = (() => Promise.reject(new TypeError("fetch failed"))) as typeof fetch;
    const provider = createOpenRouterProvider({
      apiKey: API_KEY,
      euOnly: true,
      fetchImpl,
    });
    expect(await kindOf(provider.complete(REQUEST))).toBe("unavailable");
  });

  it("aborts after timeoutMs and maps it to timeout", async () => {
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      })) as typeof fetch;
    const provider = createOpenRouterProvider({
      apiKey: API_KEY,
      euOnly: true,
      fetchImpl,
    });
    expect(await kindOf(provider.complete({ ...REQUEST, timeoutMs: 10 }))).toBe("timeout");
  });

  it("never puts the API key or the response body in the error message", async () => {
    const { fetchImpl } = fakeFetch(() => json({ error: { message: `bad key ${API_KEY}` } }, 401));
    const provider = createOpenRouterProvider({
      apiKey: API_KEY,
      euOnly: true,
      fetchImpl,
    });
    const error = await provider.complete(REQUEST).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(String(error)).not.toContain(API_KEY);
    expect(JSON.stringify(error)).not.toContain(API_KEY);
  });

  it("lists distinct models from /endpoints/zdr", async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      json({
        data: [
          { model_id: "vendor/zeta", model_name: "Zeta", provider_name: "A" },
          { model_id: "vendor/alpha", model_name: "Alpha", provider_name: "A" },
          { model_id: "vendor/zeta", model_name: "Zeta", provider_name: "B" },
          { id: "vendor/mid", name: "Mid" },
          { provider_name: "no id" },
        ],
      }),
    );
    const provider = createOpenRouterProvider({
      apiKey: API_KEY,
      euOnly: true,
      fetchImpl,
    });
    expect(await provider.listModels()).toEqual([
      { id: "vendor/alpha", name: "Alpha" },
      { id: "vendor/mid", name: "Mid" },
      { id: "vendor/zeta", name: "Zeta" },
    ]);
    expect(calls[0]?.url).toBe("https://eu.openrouter.ai/api/v1/endpoints/zdr");
    expect(calls[0]?.init?.method ?? "GET").toBe("GET");
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe(`Bearer ${API_KEY}`);
  });

  it("maps a failed model list like a completion", async () => {
    const { fetchImpl } = fakeFetch(() => json({}, 401));
    const provider = createOpenRouterProvider({
      apiKey: API_KEY,
      euOnly: false,
      fetchImpl,
    });
    expect(await kindOf(provider.listModels())).toBe("auth");
  });
});
