/** Provider-neutral types. Business code never sees a provider SDK, only these shapes. */

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type CompletionRequest = {
  model: string;
  system: string;
  messages: ChatMessage[];
  schemaName: string;
  jsonSchema: object;
  maxTokens: number;
  timeoutMs: number;
};

export type CompletionResult = {
  content: string;
  model: string;
  /** The upstream host that served the call, when the provider reports it. */
  provider: string | null;
};

export type ProviderErrorKind =
  "auth" | "regionNotAllowed" | "noEndpoint" | "rateLimited" | "timeout" | "unavailable";

const MESSAGES: Record<ProviderErrorKind, string> = {
  auth: "The AI provider rejected the key",
  regionNotAllowed: "The AI provider plan does not include regional routing",
  noEndpoint: "No provider endpoint matches the model and privacy settings",
  rateLimited: "The AI provider is rate limiting requests",
  timeout: "The AI provider did not answer in time",
  unavailable: "The AI provider is unavailable",
};

/** A failed provider call. The message is fixed per kind: never the key, the prompt or the response body. */
export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;

  constructor(kind: ProviderErrorKind) {
    super(MESSAGES[kind]);
    this.name = "ProviderError";
    this.kind = kind;
  }
}

export type ProviderRouting = { baseUrl: string; zdr: true; dataCollection: "deny" };

export interface AiProvider {
  readonly name: string;
  readonly routing: ProviderRouting;
  complete(r: CompletionRequest): Promise<CompletionResult>;
  listModels(): Promise<{ id: string; name: string }[]>;
}
