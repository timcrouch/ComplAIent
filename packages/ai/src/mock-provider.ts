import { MOCK_REPLIES } from "./mock/replies.js";
import { ProviderError, type AiProvider, type CompletionRequest } from "./provider.js";

/** Test and e2e only; refused in production at startup (`assertNotMockInProduction`, P3-R9). */
export const MOCK_MODEL = { id: "mock/isms-test", name: "Test model" } as const;
export const MOCK_INVALID_MARKER = "[[mock:invalid]]";
export const MOCK_AUTH_MARKER = "[[mock:auth]]";

export type MockProviderOptions = {
  /** Overrides the default replies: the returned string is the content; a ProviderError is thrown. */
  script?: (request: CompletionRequest) => string | ProviderError;
};

function userSays(request: CompletionRequest, marker: string): boolean {
  return request.messages.some((m) => m.role === "user" && m.content.includes(marker));
}

function defaultReply(request: CompletionRequest): string {
  if (userSays(request, MOCK_AUTH_MARKER)) throw new ProviderError("auth");
  if (userSays(request, MOCK_INVALID_MARKER)) return "This is not JSON.";
  if (!Object.hasOwn(MOCK_REPLIES, request.schemaName)) throw new ProviderError("unavailable");
  const reply = MOCK_REPLIES[request.schemaName];
  if (!reply) throw new ProviderError("unavailable");
  return reply(request);
}

export function createMockProvider(options: MockProviderOptions = {}): AiProvider {
  return {
    name: "mock",
    routing: { baseUrl: "mock://isms", zdr: true, dataCollection: "deny" },
    complete(request) {
      try {
        const outcome = options.script ? options.script(request) : defaultReply(request);
        if (outcome instanceof ProviderError) throw outcome;
        return Promise.resolve({ content: outcome, model: request.model, provider: "mock" });
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new ProviderError("unavailable"));
      }
    },
    listModels: () => Promise.resolve([{ ...MOCK_MODEL }]),
  };
}
