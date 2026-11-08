import {
  ANNEX_III_AREAS,
  DEROGATIONS,
  PROHIBITED_PRACTICES,
  TRANSPARENCY_DUTIES,
  type AnnexIIIArea,
  type Derogation,
  type ProhibitedPractice,
  type TransparencyDuty,
} from "@isms/domain";

/** Every reason code `classifyAiSystem` gives; each is a sentence under `aiActRules.reasons`. */
export type ReasonCode =
  | "not_ai_system"
  | `prohibited.${ProhibitedPractice}`
  | "annex_i.safety_component"
  | `annex_iii.${AnnexIIIArea}`
  | "annex_iii.profiling"
  | "annex_iii.no_derogation"
  | `derogation.${Exclude<Derogation, "none">}`
  | `transparency.${TransparencyDuty}`
  | "minimal_risk";

export const REASON_CODES: readonly ReasonCode[] = [
  "not_ai_system",
  ...PROHIBITED_PRACTICES.map((p) => `prohibited.${p}` as const),
  "annex_i.safety_component",
  ...ANNEX_III_AREAS.map((a) => `annex_iii.${a}` as const),
  "annex_iii.profiling",
  "annex_iii.no_derogation",
  ...DEROGATIONS.filter((d) => d !== "none").map((d) => `derogation.${d}` as const),
  ...TRANSPARENCY_DUTIES.map((d) => `transparency.${d}` as const),
  "minimal_risk",
];

/** A code the web has a sentence for; an unknown one (a newer API) gets a general sentence. */
export function isReasonCode(code: string): code is ReasonCode {
  return (REASON_CODES as readonly string[]).includes(code);
}
