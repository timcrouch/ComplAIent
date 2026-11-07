import { z } from "zod";
import {
  ProviderError,
  type AiProvider,
  type ChatMessage,
  type ProviderErrorKind,
} from "./provider.js";
import type { AiCallStatus, AiLogger, AiPurpose, AiStore } from "./store.js";

export type StructuredCall<T> = {
  purpose: AiPurpose;
  model: string;
  system: string;
  messages: ChatMessage[];
  schema: z.ZodType<T>;
  schemaName: string;
  maxTokens: number;
  timeoutMs: number;
  actorUserId: string | null;
  object?: { type: string; id: string };
};

export type RunResult<T> =
  | { ok: true; value: T; interactionId: string }
  | {
      ok: false;
      reason: "invalidOutput" | "providerError";
      providerKind?: ProviderErrorKind;
      interactionId: string;
    };

export type StructuredDeps = {
  provider: AiProvider;
  store: AiStore;
  logger?: AiLogger | undefined;
};

const MAX_ATTEMPTS = 2;

type JsonNode = Record<string, unknown>;

function isNode(value: unknown): value is JsonNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isObjectSchema(node: JsonNode): boolean {
  const type = node["type"];
  return (
    type === "object" ||
    (Array.isArray(type) && type.includes("object")) ||
    "properties" in node ||
    "additionalProperties" in node
  );
}

const SUB_SCHEMA_KEYS = [
  "items",
  "prefixItems",
  "anyOf",
  "oneOf",
  "allOf",
  "additionalProperties",
  "not",
];

/** Checks one node for strict mode and recurses into every place a sub-schema can sit. */
function assertStrict(node: unknown, path: string): void {
  if (Array.isArray(node)) {
    node.forEach((child, i) => {
      assertStrict(child, `${path}[${String(i)}]`);
    });
    return;
  }
  if (!isNode(node)) return;
  if (isObjectSchema(node)) {
    const properties = node["properties"];
    if (!isNode(properties)) {
      throw new Error(
        `AI schema at ${path} is an object that must declare its properties (records and free-form objects are not allowed in strict mode)`,
      );
    }
    const keys = Object.keys(properties);
    const required = Array.isArray(node["required"]) ? (node["required"] as unknown[]) : [];
    const optional = keys.filter((key) => !required.includes(key));
    if (optional.length > 0) {
      throw new Error(
        `AI schema at ${path} has optional properties (${optional.join(", ")}); use nullable instead`,
      );
    }
    if (node["additionalProperties"] !== false) {
      throw new Error(`AI schema at ${path} must not allow additional properties; use .strict()`);
    }
    for (const [key, child] of Object.entries(properties)) assertStrict(child, `${path}.${key}`);
  }
  for (const key of SUB_SCHEMA_KEYS) {
    if (key in node) assertStrict(node[key], `${path}.${key}`);
  }
  for (const key of ["$defs", "definitions"]) {
    const defs = node[key];
    if (isNode(defs))
      for (const [name, def] of Object.entries(defs)) assertStrict(def, `${path}.${name}`);
  }
}

/** Throws a programming error if a JSON Schema is not usable in strict structured-output mode. */
export function assertStrictJsonSchema(json: object): void {
  assertStrict(json, "$");
}

/**
 * The JSON Schema sent as `response_format` (strict mode): from `z.toJSONSchema`, without `$schema`,
 * and rejected if any object allows extra or optional properties.
 */
export function toStrictJsonSchema(schema: z.ZodType): JsonNode {
  const json: JsonNode = { ...(z.toJSONSchema(schema) as JsonNode) };
  delete json["$schema"];
  assertStrictJsonSchema(json);
  return json;
}

/** Strict JSON first; tolerates a model wrapping the object in a Markdown code fence. */
function parseContent<T>(
  content: string,
  schema: z.ZodType<T>,
): { ok: true; value: T } | { ok: false } {
  let text = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text);
  if (fenced?.[1] !== undefined) text = fenced[1];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  const parsed = schema.safeParse(raw);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
}

/**
 * One structured AI call: up to two attempts on invalid output (same request), no retry on a
 * provider error, exactly one `AiInteraction` written. Logs carry no prompt or response content.
 */
export async function runStructured<T>(
  deps: StructuredDeps,
  call: StructuredCall<T>,
): Promise<RunResult<T>> {
  const { provider, store, logger } = deps;
  const request = {
    model: call.model,
    system: call.system,
    messages: call.messages,
    schemaName: call.schemaName,
    jsonSchema: toStrictJsonSchema(call.schema),
    maxTokens: call.maxTokens,
    timeoutMs: call.timeoutMs,
  };
  const started = performance.now();
  let attempts = 0;
  let response: string | null = null;
  let model = call.model;
  let upstream: string | null = null;
  let status: AiCallStatus = "invalid_output";
  let value: T | undefined;
  let providerKind: ProviderErrorKind | undefined;

  while (attempts < MAX_ATTEMPTS) {
    attempts += 1;
    try {
      const result = await provider.complete(request);
      response = result.content;
      model = result.model;
      upstream = result.provider;
    } catch (error) {
      status = "provider_error";
      providerKind = error instanceof ProviderError ? error.kind : "unavailable";
      break;
    }
    const parsed = parseContent(response, call.schema);
    if (parsed.ok) {
      status = "ok";
      value = parsed.value;
      break;
    }
  }

  const durationMs = Math.round(performance.now() - started);
  const interactionId = await store.recordInteraction({
    purpose: call.purpose,
    provider: provider.name,
    model,
    routing: { ...provider.routing, upstream },
    request: { system: call.system, messages: call.messages },
    response,
    status,
    attempts,
    durationMs,
    actorUserId: call.actorUserId,
    objectType: call.object?.type ?? null,
    objectId: call.object?.id ?? null,
  });

  const event = {
    event: "ai.call",
    purpose: call.purpose,
    status,
    attempts,
    durationMs,
    interactionId,
  };
  if (status === "ok") {
    logger?.info(event, "AI call completed");
    return { ok: true, value: value as T, interactionId };
  }
  if (status === "provider_error") {
    logger?.warn({ ...event, providerKind }, "AI call failed at the provider");
    return {
      ok: false,
      reason: "providerError",
      ...(providerKind ? { providerKind } : {}),
      interactionId,
    };
  }
  logger?.warn(event, "AI call returned invalid output");
  return { ok: false, reason: "invalidOutput", interactionId };
}
