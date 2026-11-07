import type { AiModelsDto, AiSettingsDto } from "@isms/contracts";

export type ModelPurpose = keyof AiModelsDto;
export const PURPOSES: readonly ModelPurpose[] = ["conversation", "controls", "frameworks"];

export type PurposeState = "ready" | "noModel" | "waiting";

/**
 * Readiness for each purpose. The API's readiness is the conjunction over all three (it says
 * `noModel` until every model is chosen); everything it checks before the model (secrets key,
 * key, privacy, master switch) applies to every purpose alike, so once only models are
 * missing, a purpose with a model is ready on its own.
 */
export function purposeReadiness(
  settings: Pick<AiSettingsDto, "readiness" | "models">,
): { purpose: ModelPurpose; state: PurposeState }[] {
  const { ready, reason } = settings.readiness;
  return PURPOSES.map((purpose) => ({
    purpose,
    state:
      ready || (reason === "noModel" && settings.models[purpose])
        ? "ready"
        : reason === "noModel"
          ? "noModel"
          : "waiting",
  }));
}
