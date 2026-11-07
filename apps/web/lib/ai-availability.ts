import type { AiSettingsDto } from "@isms/contracts";

/**
 * Whether the AI can suggest frameworks now, from the settings the administrator reads. The
 * overall readiness covers every purpose; the checks before "noModel" (key, privacy, switch)
 * are shared, so a "noModel" there may be another purpose's, and the frameworks model decides.
 */
export function frameworkSuggestionsReady(settings: AiSettingsDto): boolean {
  if (!settings.enabled || settings.models.frameworks === null) return false;
  return settings.readiness.ready || settings.readiness.reason === "noModel";
}
