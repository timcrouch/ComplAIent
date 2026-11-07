import type { CompletionRequest } from "../src/provider.js";

export const REQUEST: CompletionRequest = {
  model: "vendor/model-a",
  system: "You are a test.",
  messages: [{ role: "user", content: "Hello there" }],
  schemaName: "connection_test",
  jsonSchema: { type: "object" },
  maxTokens: 100,
  timeoutMs: 1000,
};

export type Captured = { url: string; init: RequestInit | undefined; body: unknown };

/** A fake fetch that records each call and answers with the given responder. */
export function fakeFetch(respond: (url: string) => Response | Promise<Response>): {
  fetchImpl: typeof fetch;
  calls: Captured[];
} {
  const calls: Captured[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const raw = init?.body;
    calls.push({ url, init, body: typeof raw === "string" ? JSON.parse(raw) : undefined });
    return respond(url);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function completion(content: string): Response {
  return json({
    id: "gen-1",
    model: "vendor/model-a",
    provider: "SomeEuHost",
    choices: [{ message: { role: "assistant", content } }],
  });
}
