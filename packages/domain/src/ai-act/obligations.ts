import type {
  AiActRole,
  AnnexIIIArea,
  ClassificationAnswers,
  ClassificationResult,
  TransparencyDuty,
} from "./answers.js";

type Applies = (
  result: ClassificationResult,
  role: AiActRole,
  answers: ClassificationAnswers,
) => boolean;

/** Annex III point 5(a)-(c): the uses whose deployers owe a FRIA (Art. 27), per spec §5. */
const FRIA_AREAS: readonly AnnexIIIArea[] = [
  "essential_public_services",
  "creditworthiness",
  "life_health_insurance",
];

const highRisk =
  (role: AiActRole): Applies =>
  (result, r) =>
    result.riskClass === "high_risk" && r === role;

const transparency =
  (role: AiActRole, duty: TransparencyDuty): Applies =>
  (result, r) =>
    r === role && result.transparencyDuties.includes(duty);

/**
 * The obligation catalogue (spec §5), in display order. Duties of general-purpose AI model
 * providers (Art. 53-55) are out of scope: they fall on model providers, not on our clients.
 * The keys are stored on `AiSystemObligation`, so a key is never renamed or removed.
 */
export const AI_OBLIGATIONS = [
  {
    key: "ai_literacy",
    article: "Art. 4",
    appliesTo: (result, role) =>
      result.riskClass !== "out_of_scope" && (role === "provider" || role === "deployer"),
  },
  {
    key: "stop_prohibited_practice",
    article: "Art. 5",
    appliesTo: (result) => result.riskClass === "prohibited",
  },
  { key: "risk_management_system", article: "Art. 9", appliesTo: highRisk("provider") },
  { key: "data_governance", article: "Art. 10", appliesTo: highRisk("provider") },
  { key: "technical_documentation", article: "Art. 11", appliesTo: highRisk("provider") },
  { key: "automatic_logging", article: "Art. 12", appliesTo: highRisk("provider") },
  { key: "instructions_for_deployers", article: "Art. 13", appliesTo: highRisk("provider") },
  { key: "human_oversight_by_design", article: "Art. 14", appliesTo: highRisk("provider") },
  { key: "accuracy_robustness_security", article: "Art. 15", appliesTo: highRisk("provider") },
  { key: "quality_management_system", article: "Art. 17", appliesTo: highRisk("provider") },
  { key: "conformity_assessment", article: "Art. 43", appliesTo: highRisk("provider") },
  { key: "eu_declaration_and_ce_marking", article: "Art. 47–48", appliesTo: highRisk("provider") },
  { key: "eu_database_registration", article: "Art. 49(1)", appliesTo: highRisk("provider") },
  { key: "post_market_monitoring", article: "Art. 72", appliesTo: highRisk("provider") },
  { key: "serious_incident_reporting", article: "Art. 73", appliesTo: highRisk("provider") },
  { key: "corrective_actions", article: "Art. 20", appliesTo: highRisk("provider") },
  { key: "use_per_instructions", article: "Art. 26(1)", appliesTo: highRisk("deployer") },
  { key: "assign_human_oversight", article: "Art. 26(2)", appliesTo: highRisk("deployer") },
  { key: "input_data_quality", article: "Art. 26(4)", appliesTo: highRisk("deployer") },
  { key: "monitor_and_report", article: "Art. 26(5)", appliesTo: highRisk("deployer") },
  { key: "keep_logs_six_months", article: "Art. 26(6)", appliesTo: highRisk("deployer") },
  { key: "inform_workers", article: "Art. 26(7)", appliesTo: highRisk("deployer") },
  { key: "inform_affected_people", article: "Art. 26(11)", appliesTo: highRisk("deployer") },
  { key: "dpia_where_required", article: "Art. 26(9)", appliesTo: highRisk("deployer") },
  { key: "right_to_explanation", article: "Art. 86", appliesTo: highRisk("deployer") },
  {
    key: "fundamental_rights_impact_assessment",
    article: "Art. 27",
    appliesTo: (result, role, answers) =>
      highRisk("deployer")(result, role, answers) &&
      answers.annexIIIAreas.some((area) => FRIA_AREAS.includes(area)),
  },
  { key: "importer_verification", article: "Art. 23", appliesTo: highRisk("importer") },
  { key: "distributor_verification", article: "Art. 24", appliesTo: highRisk("distributor") },
  {
    key: "document_not_high_risk_assessment",
    article: "Art. 6(4)",
    appliesTo: (result, role) => result.derogationApplied && role === "provider",
  },
  {
    key: "register_not_high_risk",
    article: "Art. 49(2)",
    appliesTo: (result, role) => result.derogationApplied && role === "provider",
  },
  {
    key: "disclose_ai_interaction",
    article: "Art. 50(1)",
    appliesTo: transparency("provider", "interacts_with_people"),
  },
  {
    key: "mark_synthetic_content",
    article: "Art. 50(2)",
    appliesTo: transparency("provider", "generates_synthetic_content"),
  },
  {
    key: "inform_emotion_or_biometric_exposure",
    article: "Art. 50(3)",
    appliesTo: transparency("deployer", "emotion_recognition_or_biometric_categorisation"),
  },
  {
    key: "disclose_deep_fake",
    article: "Art. 50(4)",
    appliesTo: transparency("deployer", "deep_fake"),
  },
  {
    key: "disclose_ai_generated_text",
    article: "Art. 50(4)",
    appliesTo: transparency("deployer", "public_interest_text"),
  },
] as const satisfies readonly { key: string; article: string; appliesTo: Applies }[];

export type AiObligationKey = (typeof AI_OBLIGATIONS)[number]["key"];

/** Every catalogue key, in display order (a tuple, for `z.enum`). */
export const AI_OBLIGATION_KEYS = AI_OBLIGATIONS.map((o) => o.key) as unknown as readonly [
  AiObligationKey,
  ...AiObligationKey[],
];

/** The catalogue entry of a key. */
export function aiObligation(key: AiObligationKey): (typeof AI_OBLIGATIONS)[number] {
  const entry = AI_OBLIGATIONS.find((o) => o.key === key);
  if (!entry) throw new Error(`Unknown AI Act obligation: ${key}`);
  return entry;
}

/** The keys that apply to a system with this result, role and answers, in catalogue order. */
export function applicableObligations(
  result: ClassificationResult,
  role: AiActRole,
  answers: ClassificationAnswers,
): AiObligationKey[] {
  return AI_OBLIGATIONS.filter((o) => o.appliesTo(result, role, answers)).map((o) => o.key);
}
