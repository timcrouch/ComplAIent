export {
  AI_ACT_ROLES,
  AI_OBLIGATION_STATUSES,
  AI_RISK_CLASSES,
  AI_SYSTEM_RISK_CLASSES,
  AI_SYSTEM_STATUSES,
  ANNEX_III_AREAS,
  DEROGATIONS,
  PROHIBITED_PRACTICES,
  TRANSPARENCY_DUTIES,
} from "./answers.js";
export type {
  AiActRole,
  AiObligationStatus,
  AiRiskClass,
  AiSystemRiskClass,
  AiSystemStatus,
  AnnexIIIArea,
  ClassificationAnswers,
  ClassificationReason,
  ClassificationResult,
  Derogation,
  ProhibitedPractice,
  TransparencyDuty,
} from "./answers.js";
export { classifyAiSystem } from "./classify.js";
export {
  AI_OBLIGATIONS,
  AI_OBLIGATION_KEYS,
  aiObligation,
  applicableObligations,
} from "./obligations.js";
export type { AiObligationKey } from "./obligations.js";
