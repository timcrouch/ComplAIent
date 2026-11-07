import {
  ProviderError,
  type AiProvider,
  type CompletionRequest,
  type CompletionResult,
  type ProviderErrorKind,
} from "./provider.js";

/** OpenRouter's in-region base URL (Business and Enterprise plans), used when EU-only is on (P3-R8). */
export const OPENROUTER_EU_BASE_URL = "https://eu.openrouter.ai/api/v1";
export const OPENROUTER_GLOBAL_BASE_URL = "https://openrouter.ai/api/v1";
const LIST_TIMEOUT_MS = 10_000;

/** Sent on every request: zero-data-retention endpoints only, no training on our data, and only
 * endpoints that honour every parameter (so structured output is never silently dropped). */
const PROVIDER_PREFERENCES = {
  zdr: true,
  data_collection: "deny",
  require_parameters: true,
} as const;

export type OpenRouterOptions = { apiKey: string; euOnly: boolean; fetchImpl?: typeof fetch };

function kindForStatus(status: number, body: string): ProviderErrorKind {
  if (status === 403 && /regional routing/i.test(body)) return "regionNotAllowed";
  if (status === 401 || status === 403) return "auth";
  if (status === 404 || body.includes("No endpoints found")) return "noEndpoint";
  if (status === 429) return "rateLimited";
  return "unavailable";
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

type ChatResponse = {
  model?: unknown;
  provider?: unknown;
  error?: { code?: unknown; message?: unknown };
  choices?: { message?: { content?: unknown } }[];
};

type ZdrResponse = {
  data?: { model_id?: unknown; id?: unknown; model_name?: unknown; name?: unknown }[];
};

export function createOpenRouterProvider({
  apiKey,
  euOnly,
  fetchImpl = fetch,
}: OpenRouterOptions): AiProvider {
  const baseUrl = euOnly ? OPENROUTER_EU_BASE_URL : OPENROUTER_GLOBAL_BASE_URL;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "X-Title": "ISMS",
  };

  /** Fetches and parses JSON; every failure becomes a ProviderError without the body or the key. */
  async function request<T>(path: string, init: RequestInit, timeoutMs: number): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) throw new ProviderError(kindForStatus(response.status, text));
      return JSON.parse(text) as T;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(
        isAbort(error) || controller.signal.aborted ? "timeout" : "unavailable",
      );
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    name: "openrouter",
    routing: { baseUrl, zdr: true, dataCollection: "deny" },

    async complete(r: CompletionRequest): Promise<CompletionResult> {
      const body = {
        model: r.model,
        messages: [{ role: "system", content: r.system }, ...r.messages],
        response_format: {
          type: "json_schema",
          json_schema: { name: r.schemaName, strict: true, schema: r.jsonSchema },
        },
        // No temperature: ZDR endpoints of current models reject it, and require_parameters
        // would then leave no endpoint ("No endpoints found that can handle the requested parameters").
        max_tokens: r.maxTokens,
        provider: PROVIDER_PREFERENCES,
      };
      const json = await request<ChatResponse>(
        "/chat/completions",
        { method: "POST", body: JSON.stringify(body) },
        r.timeoutMs,
      );
      if (json.error) {
        const code = typeof json.error.code === "number" ? json.error.code : 500;
        const message = typeof json.error.message === "string" ? json.error.message : "";
        throw new ProviderError(kindForStatus(code, message));
      }
      const content = json.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new ProviderError("unavailable");
      return {
        content,
        model: typeof json.model === "string" ? json.model : r.model,
        provider: typeof json.provider === "string" ? json.provider : null,
      };
    },

    async listModels() {
      const json = await request<ZdrResponse>("/endpoints/zdr", { method: "GET" }, LIST_TIMEOUT_MS);
      const byId = new Map<string, string>();
      for (const endpoint of json.data ?? []) {
        const id = typeof endpoint.model_id === "string" ? endpoint.model_id : endpoint.id;
        if (typeof id !== "string" || id === "" || byId.has(id)) continue;
        const name = typeof endpoint.model_name === "string" ? endpoint.model_name : endpoint.name;
        byId.set(id, typeof name === "string" && name !== "" ? name : id);
      }
      return [...byId.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([id, name]) => ({ id, name }));
    },
  };
}
