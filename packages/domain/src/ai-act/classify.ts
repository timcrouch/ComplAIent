import {
  ANNEX_III_AREAS,
  type AnnexIIIArea,
  type ClassificationAnswers,
  type ClassificationReason,
  type ClassificationResult,
  type Derogation,
  PROHIBITED_PRACTICES,
  type ProhibitedPractice,
  TRANSPARENCY_DUTIES,
  type TransparencyDuty,
} from "./answers.js";

const PROHIBITED_ARTICLE: Readonly<Record<ProhibitedPractice, string>> = {
  subliminal_manipulation: "Art. 5(1)(a)",
  exploiting_vulnerabilities: "Art. 5(1)(b)",
  social_scoring: "Art. 5(1)(c)",
  crime_prediction_profiling: "Art. 5(1)(d)",
  untargeted_face_scraping: "Art. 5(1)(e)",
  emotion_recognition_work_education: "Art. 5(1)(f)",
  biometric_categorisation_sensitive: "Art. 5(1)(g)",
  realtime_remote_biometric_id: "Art. 5(1)(h)",
};

const ANNEX_III_POINT: Readonly<Record<AnnexIIIArea, string>> = {
  biometrics: "Annex III, point 1",
  critical_infrastructure: "Annex III, point 2",
  education: "Annex III, point 3",
  employment: "Annex III, point 4",
  essential_public_services: "Annex III, point 5(a)",
  creditworthiness: "Annex III, point 5(b)",
  life_health_insurance: "Annex III, point 5(c)",
  emergency_triage: "Annex III, point 5(d)",
  law_enforcement: "Annex III, point 6",
  migration_border: "Annex III, point 7",
  justice_democracy: "Annex III, point 8",
};

const DEROGATION_ARTICLE: Readonly<Record<Exclude<Derogation, "none">, string>> = {
  narrow_procedural_task: "Art. 6(3)(a)",
  improves_completed_human_activity: "Art. 6(3)(b)",
  detects_patterns_without_replacing_review: "Art. 6(3)(c)",
  preparatory_task: "Art. 6(3)(d)",
};

const TRANSPARENCY_ARTICLE: Readonly<Record<TransparencyDuty, string>> = {
  interacts_with_people: "Art. 50(1)",
  generates_synthetic_content: "Art. 50(2)",
  emotion_recognition_or_biometric_categorisation: "Art. 50(3)",
  deep_fake: "Art. 50(4)",
  public_interest_text: "Art. 50(4)",
};

/** The chosen values in catalogue order, without repeats. */
const inOrder = <T extends string>(catalogue: readonly T[], chosen: readonly T[]): T[] =>
  catalogue.filter((value) => chosen.includes(value));

/**
 * Classifies an AI system from its questionnaire answers (spec §4). Precedence: not an AI
 * system (out_of_scope) > prohibited > high_risk > limited_risk (a transparency duty) >
 * minimal_risk. High-risk comes from Annex I (Art. 6(1)) or an Annex III area (Art. 6(2))
 * unless Art. 6(3) applies: no profiling and a derogation other than `none`. Profiling or
 * derogation left unanswered counts as not established, so the system stays high-risk.
 * Transparency duties apply on top of high-risk; a prohibited system carries none, since the
 * only thing to do is to stop. Pure and total.
 */
export function classifyAiSystem(answers: ClassificationAnswers): ClassificationResult {
  if (!answers.isAiSystem) {
    return {
      riskClass: "out_of_scope",
      transparencyDuties: [],
      derogationApplied: false,
      reasons: [{ code: "not_ai_system", article: "Art. 3(1)" }],
    };
  }

  const prohibited = inOrder(PROHIBITED_PRACTICES, answers.prohibitedPractices);
  if (prohibited.length > 0) {
    return {
      riskClass: "prohibited",
      transparencyDuties: [],
      derogationApplied: false,
      reasons: prohibited.map((p) => ({ code: `prohibited.${p}`, article: PROHIBITED_ARTICLE[p] })),
    };
  }

  const reasons: ClassificationReason[] = [];
  if (answers.annexISafetyComponent) {
    reasons.push({ code: "annex_i.safety_component", article: "Art. 6(1)" });
  }
  const areas = inOrder(ANNEX_III_AREAS, answers.annexIIIAreas);
  for (const area of areas) {
    reasons.push({ code: `annex_iii.${area}`, article: ANNEX_III_POINT[area] });
  }

  let highRisk = answers.annexISafetyComponent;
  let derogationApplied = false;
  if (areas.length > 0) {
    const derogation =
      answers.derogation === null || answers.derogation === "none" ? null : answers.derogation;
    if (answers.profilesPeople === true) {
      highRisk = true;
      reasons.push({ code: "annex_iii.profiling", article: "Art. 6(3)" });
    } else if (answers.profilesPeople === false && derogation !== null) {
      // The derogation lifts only the Annex III part; an Annex I component stays high-risk.
      if (!highRisk) {
        derogationApplied = true;
        reasons.push({
          code: `derogation.${derogation}`,
          article: DEROGATION_ARTICLE[derogation],
        });
      }
    } else {
      highRisk = true;
      reasons.push({ code: "annex_iii.no_derogation", article: "Art. 6(2)" });
    }
  }

  const transparencyDuties = inOrder(TRANSPARENCY_DUTIES, answers.transparency);
  for (const duty of transparencyDuties) {
    reasons.push({ code: `transparency.${duty}`, article: TRANSPARENCY_ARTICLE[duty] });
  }
  const riskClass = highRisk
    ? "high_risk"
    : transparencyDuties.length > 0
      ? "limited_risk"
      : "minimal_risk";
  if (riskClass === "minimal_risk") reasons.push({ code: "minimal_risk", article: "Art. 95" });
  return { riskClass, transparencyDuties, derogationApplied, reasons };
}
