import type { ChatMessage } from "./provider.js";

/** Mirrors the Prisma enums; kept as plain unions so callers need no database import. */
export type AiPurpose =
  | "concern_turn"
  | "control_suggestion"
  | "framework_suggestion"
  | "connection_test"
  | "posture_summary"
  | "control_test_steps"
  | "ai_act_classification"
  | "ai_act_obligation_guidance";
export type AiCallStatus = "ok" | "invalid_output" | "provider_error" | "refused";
export type AiOutcome = "none" | "pending" | "accepted" | "rejected" | "partial";

export type AiModelKey = "conversation" | "controls" | "frameworks";
export type AiModels = Partial<Record<AiModelKey, string>>;

export type AiSettingsRow = {
  enabled: boolean;
  euOnly: boolean;
  zeroRetention: boolean;
  sealedKey: Buffer | null;
  keyLast4: string | null;
  keySetById: string | null;
  keySetAt: Date | null;
  models: AiModels;
  updatedById: string | null;
  updatedAt: Date | null;
};

/** The settings an installation has before anyone saves them (matches the column defaults). */
export function defaultAiSettings(): AiSettingsRow {
  return {
    enabled: false,
    euOnly: true,
    zeroRetention: true,
    sealedKey: null,
    keyLast4: null,
    keySetById: null,
    keySetAt: null,
    models: {},
    updatedById: null,
    updatedAt: null,
  };
}

export type InteractionRouting = {
  baseUrl: string;
  zdr: true;
  dataCollection: "deny";
  /** The upstream host that served the call, when the provider reports it. */
  upstream: string | null;
};

export type InteractionRecord = {
  purpose: AiPurpose;
  provider: string;
  model: string;
  routing: InteractionRouting;
  request: { system: string; messages: ChatMessage[] };
  response: string | null;
  status: AiCallStatus;
  attempts: number;
  durationMs: number;
  actorUserId: string | null;
  objectType: string | null;
  objectId: string | null;
};

export interface AiStore {
  loadSettings(): Promise<AiSettingsRow>;
  recordInteraction(r: InteractionRecord): Promise<string>;
  setOutcome(id: string, outcome: AiOutcome): Promise<void>;
  /** How many suggestions were discarded after validation (unknown codes or keys). */
  setDiscardedCount(id: string, count: number): Promise<void>;
}

/** Operational logger (pino-compatible subset). Only event names, purpose, status and timings go in. */
export type AiLogger = {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
};
