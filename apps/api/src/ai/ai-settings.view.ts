import {
  type AiCallPurpose,
  type AiModelKey,
  type AiSettingsRow,
  type ProviderName,
  aiReadiness,
  type ReadinessOptions,
  openSecret,
} from "@isms/ai";
import type { AiModelsDto, AiSettingsDto, PersonRef } from "@isms/contracts";

export const MODEL_KEYS: readonly AiModelKey[] = ["conversation", "controls", "frameworks"];
const BUSINESS_PURPOSES: readonly AiCallPurpose[] = [
  "concern_turn",
  "control_suggestion",
  "framework_suggestion",
  "posture_summary",
  "control_test_steps",
];

export const modelsDto = (settings: AiSettingsRow): AiModelsDto => ({
  conversation: settings.models.conversation ?? null,
  controls: settings.models.controls ?? null,
  frameworks: settings.models.frameworks ?? null,
});

function keyReadable(sealed: Buffer, secretsKey: Buffer | undefined): boolean {
  if (!secretsKey) return false;
  try {
    openSecret(sealed, secretsKey);
    return true;
  } catch {
    return false;
  }
}

/** Ready only when every business purpose is; otherwise the first purpose's reason. */
function overallReadiness(
  settings: AiSettingsRow,
  secretsKey: Buffer | undefined,
  options: ReadinessOptions,
): AiSettingsDto["readiness"] {
  for (const purpose of BUSINESS_PURPOSES) {
    const r = aiReadiness(settings, purpose, secretsKey, options);
    if (!r.ready) return { ready: false, reason: r.reason };
  }
  return { ready: true, reason: null };
}

/** The settings as the screen sees them: the key itself never leaves, only its status. */
export function toSettingsDto(
  settings: AiSettingsRow,
  setBy: PersonRef | null,
  env: {
    secretsKey: Buffer | undefined;
    provider: ProviderName;
    allowNonEuRouting?: boolean;
  },
): AiSettingsDto {
  const { sealedKey, keyLast4, keySetAt } = settings;
  const key: AiSettingsDto["key"] =
    sealedKey && keyLast4 && keySetAt && setBy
      ? {
          set: true,
          last4: keyLast4,
          setBy,
          setAt: keySetAt.toISOString(),
          readable: keyReadable(sealedKey, env.secretsKey),
        }
      : { set: false };
  return {
    enabled: settings.enabled,
    euOnly: settings.euOnly,
    zeroRetention: settings.zeroRetention,
    key,
    models: modelsDto(settings),
    readiness: overallReadiness(settings, env.secretsKey, {
      allowNonEuRouting: env.allowNonEuRouting === true,
    }),
    secretsKeyConfigured: env.secretsKey !== undefined,
    provider: env.provider,
    nonEuRoutingAllowed: env.allowNonEuRouting === true,
  };
}
