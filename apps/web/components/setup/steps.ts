import type { SetupStep } from "@isms/contracts";
import type messages from "../../messages/index";

export type SetupStepKey =
  "organisation" | "sites" | "frameworks" | "riskAppetite" | "people" | "review";

/** Steps whose page exists, so `setup.<key>.title` and `.why` are in the message file. */
export type FrameStepKey = Extract<SetupStepKey, keyof (typeof messages)["setup"]>;

/** Optional pages listed after the steps: never in `setup.missing`, never numbered. */
export type SetupSectionKey = "modules";
export type SetupSectionDef = { key: SetupSectionKey; path: string };

export const SETUP_SECTIONS: readonly SetupSectionDef[] = [
  { key: "modules", path: "/setup/modules" },
];

/** Every page the setup frame shows: a step, or an optional section. */
export type FramePageKey = FrameStepKey | SetupSectionKey;

/** One step of guided setup. `apiStep` is the API's matching step, or null when it has none. */
export type SetupStepDef = { key: SetupStepKey; path: string; apiStep: SetupStep | null };

export const SETUP_STEPS: readonly SetupStepDef[] = [
  { key: "organisation", path: "/setup/organisation", apiStep: "profile" },
  { key: "sites", path: "/setup/sites", apiStep: "sites" },
  { key: "frameworks", path: "/setup/frameworks", apiStep: "frameworks" },
  { key: "riskAppetite", path: "/setup/risk-appetite", apiStep: "riskScale" },
  { key: "people", path: "/setup/people", apiStep: null },
  { key: "review", path: "/setup/review", apiStep: null },
];

const REVIEW = SETUP_STEPS[SETUP_STEPS.length - 1] as SetupStepDef;

/** The first step the API still reports as missing, or review when nothing is missing. */
export function firstIncompleteStep(missing: readonly SetupStep[]): SetupStepDef {
  return SETUP_STEPS.find((s) => s.apiStep !== null && missing.includes(s.apiStep)) ?? REVIEW;
}

export function stepByKey(key: SetupStepKey): SetupStepDef {
  return SETUP_STEPS.find((s) => s.key === key) as SetupStepDef;
}

/** The step after `key` (review is last and has no next step). */
export function nextStep(key: SetupStepKey): SetupStepDef {
  const i = SETUP_STEPS.findIndex((s) => s.key === key);
  return SETUP_STEPS[Math.min(i + 1, SETUP_STEPS.length - 1)] as SetupStepDef;
}

/** Done means the API no longer reports the step as missing; steps without one never show done. */
export function isStepDone(step: SetupStepDef, missing: readonly SetupStep[]): boolean {
  return step.apiStep !== null && !missing.includes(step.apiStep);
}
