import { z } from "zod";
import { createMockProvider } from "./mock-provider.js";
import { createOpenRouterProvider } from "./openrouter.js";
import { ProviderError, type AiProvider, type ProviderErrorKind } from "./provider.js";
import {
  aiReadiness,
  type AiCallPurpose,
  type AiReadiness,
  type AiReadinessReason,
  type ConnectionTestReadiness,
} from "./readiness.js";
import { openSecret, SecretUnreadableError } from "./secret-box.js";
import type { AiLogger, AiOutcome, AiPurpose, AiSettingsRow, AiStore } from "./store.js";
import { runStructured, type RunResult, type StructuredCall } from "./structured.js";

export type ProviderName = "openrouter" | "mock";

export type GatewayOptions = {
  store: AiStore;
  secretsKey: Buffer | undefined;
  provider: ProviderName;
  /** AI_ALLOW_NON_EU_ROUTING: development only; EU-only routing may be off (zero retention may not). */
  allowNonEuRouting?: boolean;
  fetchImpl?: typeof fetch;
  /** Test seam: builds the provider instead of OpenRouter or the mock. */
  providerFactory?: (settings: AiSettingsRow, apiKey: string) => AiProvider;
  logger?: AiLogger;
};

/** A call for a purpose: the model comes from the settings, never from the caller. */
export type GatewayCall<T> = Omit<StructuredCall<T>, "purpose" | "model">;
type NotReady = { ready: false; reason: AiReadinessReason };
export type GatewayRunResult<T> = RunResult<T> | { ok: false; reason: AiReadinessReason };

export type ConnectionTestReason =
  "noKey" | "privacyOff" | "secretsKeyMissing" | "keyUnreadable" | ProviderErrorKind;
export type ConnectionTestResult =
  { ok: true; model: string } | { ok: false; reason: ConnectionTestReason };

/** The reasons a key problem stops listing models (privacy and the switch do not: no user data is sent). */
export class AiKeyUnavailableError extends Error {
  readonly reason: "noKey" | "secretsKeyMissing" | "keyUnreadable";

  constructor(reason: "noKey" | "secretsKeyMissing" | "keyUnreadable") {
    super(`The AI provider key is not usable: ${reason}`);
    this.name = "AiKeyUnavailableError";
    this.reason = reason;
  }
}

export const CONNECTION_TEST_PROMPT = 'Reply with {"ok":true}.';
const ConnectionTestSchema = z.object({ ok: z.boolean() }).strict();

export type AiGateway = ReturnType<typeof createGateway>;

/** The one readiness, provider and recording path shared by the API and the worker. */
export function createGateway(options: GatewayOptions) {
  const { store, secretsKey, logger } = options;
  const readinessOptions = { allowNonEuRouting: options.allowNonEuRouting === true };

  function openKey(settings: AiSettingsRow): string {
    if (!settings.sealedKey) throw new AiKeyUnavailableError("noKey");
    if (!secretsKey) throw new AiKeyUnavailableError("secretsKeyMissing");
    try {
      return openSecret(settings.sealedKey, secretsKey);
    } catch (error) {
      if (error instanceof SecretUnreadableError) throw new AiKeyUnavailableError("keyUnreadable");
      throw error;
    }
  }

  function buildProvider(settings: AiSettingsRow): AiProvider {
    const apiKey = openKey(settings);
    if (options.providerFactory) return options.providerFactory(settings, apiKey);
    if (options.provider === "mock") return createMockProvider();
    return createOpenRouterProvider({
      apiKey,
      euOnly: settings.euOnly,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
  }

  /** Loads settings, checks readiness and builds the provider; never builds one when not ready. */
  async function prepare<M extends string | null>(
    check: (settings: AiSettingsRow) => { ready: true; model: M } | NotReady,
  ): Promise<NotReady | { ready: true; model: M; provider: AiProvider }> {
    const settings = await store.loadSettings();
    const readiness = check(settings);
    if (!readiness.ready) return readiness;
    try {
      return { ready: true, model: readiness.model, provider: buildProvider(settings) };
    } catch (error) {
      if (error instanceof AiKeyUnavailableError) return { ready: false, reason: error.reason };
      throw error;
    }
  }

  async function readiness(purpose: "connection_test"): Promise<ConnectionTestReadiness>;
  async function readiness(purpose: AiCallPurpose): Promise<AiReadiness>;
  async function readiness(purpose: AiPurpose): Promise<AiReadiness | ConnectionTestReadiness> {
    return aiReadiness(await store.loadSettings(), purpose, secretsKey, readinessOptions);
  }

  return {
    readiness,

    /** A business call. connection_test is not callable here; it goes through test(). */
    async run<T>(purpose: AiCallPurpose, call: GatewayCall<T>): Promise<GatewayRunResult<T>> {
      const prepared = await prepare((settings) =>
        aiReadiness(settings, purpose, secretsKey, readinessOptions),
      );
      if (!prepared.ready) {
        logger?.info({ event: "ai.refused", purpose, reason: prepared.reason }, "AI call refused");
        return { ok: false, reason: prepared.reason };
      }
      return runStructured(
        { provider: prepared.provider, store, logger },
        { ...call, purpose, model: prepared.model },
      );
    },

    setOutcome(id: string, outcome: AiOutcome): Promise<void> {
      return store.setOutcome(id, outcome);
    },

    /** How many returned suggestions were not stored (unknown, repeated, already linked or over the limit). */
    setDiscardedCount(id: string, count: number): Promise<void> {
      return store.setDiscardedCount(id, count);
    },

    /** Models the provider offers under the privacy settings. Throws AiKeyUnavailableError or ProviderError. */
    async listModels(): Promise<{ id: string; name: string }[]> {
      return buildProvider(await store.loadSettings()).listModels();
    },

    /** The admin connection test: a harmless prompt, recorded as purpose connection_test. */
    async test(context: { actorUserId?: string | null } = {}): Promise<ConnectionTestResult> {
      const prepared = await prepare((settings) =>
        aiReadiness(settings, "connection_test", secretsKey, readinessOptions),
      );
      if (!prepared.ready) {
        // connection_test readiness never reports disabled or noModel.
        return { ok: false, reason: prepared.reason as ConnectionTestReason };
      }
      let model = prepared.model;
      if (model === null) {
        try {
          model = (await prepared.provider.listModels())[0]?.id ?? null;
        } catch (error) {
          return { ok: false, reason: error instanceof ProviderError ? error.kind : "unavailable" };
        }
        if (model === null) return { ok: false, reason: "noEndpoint" };
      }
      const result = await runStructured(
        { provider: prepared.provider, store, logger },
        {
          purpose: "connection_test",
          model,
          system: "You check that the connection works. Answer with JSON only.",
          messages: [{ role: "user", content: CONNECTION_TEST_PROMPT }],
          schema: ConnectionTestSchema,
          schemaName: "connection_test",
          maxTokens: 50,
          timeoutMs: 20_000,
          actorUserId: context.actorUserId ?? null,
        },
      );
      if (result.ok) return { ok: true, model };
      return { ok: false, reason: result.providerKind ?? "unavailable" };
    },
  };
}
