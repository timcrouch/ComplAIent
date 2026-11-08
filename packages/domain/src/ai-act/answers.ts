/**
 * The EU AI Act questionnaire (Regulation (EU) 2024/1689): the answer vocabulary, shared by the
 * classification rules here, the contract schemas and the AI purposes. Every list is in the
 * order of the Regulation, which is also the order reasons and duties are reported in.
 */

/** The operator roles of Art. 3(3)-(7) a client can hold for a system. */
export const AI_ACT_ROLES = ["provider", "deployer", "importer", "distributor"] as const;
export type AiActRole = (typeof AI_ACT_ROLES)[number];

export const AI_SYSTEM_STATUSES = ["planned", "in_use", "retired"] as const;
export type AiSystemStatus = (typeof AI_SYSTEM_STATUSES)[number];

/** The classes a classification can give. */
export const AI_RISK_CLASSES = [
  "out_of_scope",
  "prohibited",
  "high_risk",
  "limited_risk",
  "minimal_risk",
] as const;
export type AiRiskClass = (typeof AI_RISK_CLASSES)[number];

/** A stored system's class: `unclassified` until its first classification is saved. */
export const AI_SYSTEM_RISK_CLASSES = ["unclassified", ...AI_RISK_CLASSES] as const;
export type AiSystemRiskClass = (typeof AI_SYSTEM_RISK_CLASSES)[number];

export const AI_OBLIGATION_STATUSES = ["open", "in_progress", "met", "not_applicable"] as const;
export type AiObligationStatus = (typeof AI_OBLIGATION_STATUSES)[number];

/** Art. 5(1)(a)-(h), in that order. */
export const PROHIBITED_PRACTICES = [
  "subliminal_manipulation",
  "exploiting_vulnerabilities",
  "social_scoring",
  "crime_prediction_profiling",
  "untargeted_face_scraping",
  "emotion_recognition_work_education",
  "biometric_categorisation_sensitive",
  "realtime_remote_biometric_id",
] as const;
export type ProhibitedPractice = (typeof PROHIBITED_PRACTICES)[number];

/** Annex III points 1-8; point 5 is split into its four uses (a)-(d). */
export const ANNEX_III_AREAS = [
  "biometrics",
  "critical_infrastructure",
  "education",
  "employment",
  "essential_public_services",
  "creditworthiness",
  "life_health_insurance",
  "emergency_triage",
  "law_enforcement",
  "migration_border",
  "justice_democracy",
] as const;
export type AnnexIIIArea = (typeof ANNEX_III_AREAS)[number];

/** `none`, then the Art. 6(3)(a)-(d) conditions in order. */
export const DEROGATIONS = [
  "none",
  "narrow_procedural_task",
  "improves_completed_human_activity",
  "detects_patterns_without_replacing_review",
  "preparatory_task",
] as const;
export type Derogation = (typeof DEROGATIONS)[number];

/** Art. 50(1)-(4) duties. */
export const TRANSPARENCY_DUTIES = [
  "interacts_with_people",
  "generates_synthetic_content",
  "emotion_recognition_or_biometric_categorisation",
  "deep_fake",
  "public_interest_text",
] as const;
export type TransparencyDuty = (typeof TRANSPARENCY_DUTIES)[number];

/**
 * The questionnaire's answers. `profilesPeople` and `derogation` are asked only when an
 * Annex III area is chosen; the contract requires them then and null otherwise.
 */
export type ClassificationAnswers = {
  /** Art. 3(1): a machine-based system that infers from input how to generate outputs. */
  isAiSystem: boolean;
  prohibitedPractices: readonly ProhibitedPractice[];
  /** Art. 6(1): a safety component of (or itself) an Annex I product needing third-party assessment. */
  annexISafetyComponent: boolean;
  annexIIIAreas: readonly AnnexIIIArea[];
  profilesPeople: boolean | null;
  derogation: Derogation | null;
  transparency: readonly TransparencyDuty[];
};

/**
 * What is inconsistent in a set of answers, by field: a repeated value in a list, or the
 * Annex III follow-up questions answered when no area is chosen, or unanswered when one is.
 * Empty when the answers are consistent. The contract and the AI output schema both use it.
 */
export function answerProblems(
  answers: ClassificationAnswers,
): { path: string; message: string }[] {
  const problems: { path: string; message: string }[] = [];
  for (const field of ["prohibitedPractices", "annexIIIAreas", "transparency"] as const) {
    const values: readonly string[] = answers[field];
    values.forEach((value, i) => {
      if (values.indexOf(value) !== i)
        problems.push({ path: `${field}.${String(i)}`, message: "Duplicate" });
    });
  }
  const asked = answers.annexIIIAreas.length > 0;
  for (const field of ["profilesPeople", "derogation"] as const) {
    if (asked && answers[field] === null)
      problems.push({ path: field, message: "Required when an Annex III area is chosen" });
    if (!asked && answers[field] !== null)
      problems.push({ path: field, message: "Asked only when an Annex III area is chosen" });
  }
  return problems;
}

/** Why a system has its class: a code the web turns into a sentence, and the article. */
export type ClassificationReason = { code: string; article: string };

export type ClassificationResult = {
  riskClass: AiRiskClass;
  transparencyDuties: TransparencyDuty[];
  /** An Annex III use made not high-risk by Art. 6(3); brings the Art. 6(4) and 49(2) duties. */
  derogationApplied: boolean;
  reasons: ClassificationReason[];
};
