import { openSecret } from "./secret-box.js";
import type { AiModelKey, AiPurpose, AiSettingsRow } from "./store.js";

export type AiReadinessReason =
  "disabled" | "noKey" | "privacyOff" | "noModel" | "secretsKeyMissing" | "keyUnreadable";

/** The purposes business code calls; `connection_test` is the admin screen's check only. */
export type AiCallPurpose = Exclude<AiPurpose, "connection_test">;

type NotReady = { ready: false; reason: AiReadinessReason };

/** Readiness for a business purpose: `model` is the configured model for it. */
export type AiReadiness = { ready: true; model: string } | NotReady;

/**
 * Readiness for `connection_test`: `model` is the conversation model, or null when none is chosen
 * yet (the gateway's test then uses the first listed model).
 */
export type ConnectionTestReadiness = { ready: true; model: string | null } | NotReady;

/** Which configured model each purpose uses (P3-R10 / PF3). */
export const MODEL_KEY_BY_PURPOSE: Readonly<Record<AiPurpose, AiModelKey>> = {
  concern_turn: "conversation",
  control_suggestion: "controls",
  framework_suggestion: "frameworks",
  connection_test: "conversation",
  posture_summary: "conversation",
  control_test_steps: "controls",
};

/** Deployment-level options, passed in by the caller; this package never reads the environment. */
export type ReadinessOptions = {
  /** Development only (AI_ALLOW_NON_EU_ROUTING): EU-only routing may be off. Zero retention may not. */
  allowNonEuRouting?: boolean;
};

/** Zero retention is always required; EU-only routing too, unless non-EU routing is allowed. */
export function privacyHolds(
  settings: Pick<AiSettingsRow, "euOnly" | "zeroRetention">,
  { allowNonEuRouting = false }: ReadinessOptions = {},
): boolean {
  return settings.zeroRetention && (settings.euOnly || allowNonEuRouting);
}

function keyReadable(sealed: Buffer, secretsKey: Buffer): boolean {
  try {
    openSecret(sealed, secretsKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a call for `purpose` may be made. Order: secretsKeyMissing (only when a key is stored),
 * noKey, keyUnreadable, privacyOff, disabled, noModel. `connection_test` ignores disabled and noModel,
 * but never privacy: no call leaves without zero retention and EU routing (P3-R8), where EU routing
 * is waived only by the development-only allowNonEuRouting option.
 */
export function aiReadiness(
  settings: AiSettingsRow,
  purpose: "connection_test",
  secretsKey: Buffer | undefined,
  options?: ReadinessOptions,
): ConnectionTestReadiness;
export function aiReadiness(
  settings: AiSettingsRow,
  purpose: AiCallPurpose,
  secretsKey: Buffer | undefined,
  options?: ReadinessOptions,
): AiReadiness;
export function aiReadiness(
  settings: AiSettingsRow,
  purpose: AiPurpose,
  secretsKey: Buffer | undefined,
  options?: ReadinessOptions,
): AiReadiness | ConnectionTestReadiness;
export function aiReadiness(
  settings: AiSettingsRow,
  purpose: AiPurpose,
  secretsKey: Buffer | undefined,
  options: ReadinessOptions = {},
): AiReadiness | ConnectionTestReadiness {
  const sealed = settings.sealedKey;
  if (sealed && !secretsKey) return { ready: false, reason: "secretsKeyMissing" };
  if (!sealed || !secretsKey) return { ready: false, reason: "noKey" };
  if (!keyReadable(sealed, secretsKey)) return { ready: false, reason: "keyUnreadable" };
  if (!privacyHolds(settings, options)) return { ready: false, reason: "privacyOff" };
  const model = settings.models[MODEL_KEY_BY_PURPOSE[purpose]];
  if (purpose === "connection_test") return { ready: true, model: model ?? null };
  if (!settings.enabled) return { ready: false, reason: "disabled" };
  if (!model) return { ready: false, reason: "noModel" };
  return { ready: true, model };
}
