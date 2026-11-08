import {
  AI_ACT_ROLES,
  AI_OBLIGATION_KEYS,
  AI_OBLIGATION_STATUSES,
  AI_RISK_CLASSES,
  AI_SYSTEM_RISK_CLASSES,
  AI_SYSTEM_STATUSES,
  ANNEX_III_AREAS,
  DEROGATIONS,
  PROHIBITED_PRACTICES,
  TRANSPARENCY_DUTIES,
  answerProblems,
} from "@isms/domain";
import { z } from "zod";
import "../zod.js";
import { DepartmentDto } from "./organisation.js";
import { PersonRef, RiskStateSchema } from "./risk-dtos.js";

export const AiActRoleSchema = z.enum(AI_ACT_ROLES).openapi("AiActRole");
export const AiSystemStatusSchema = z.enum(AI_SYSTEM_STATUSES).openapi("AiSystemStatus");
/** The classes a classification gives. */
export const AiRiskClassSchema = z.enum(AI_RISK_CLASSES).openapi("AiRiskClass");
/** A stored system's class: `unclassified` until its first classification. */
export const AiSystemRiskClassSchema = z.enum(AI_SYSTEM_RISK_CLASSES).openapi("AiSystemRiskClass");
export const AiObligationStatusSchema = z
  .enum(AI_OBLIGATION_STATUSES)
  .openapi("AiObligationStatus");
export const AiObligationKeySchema = z.enum(AI_OBLIGATION_KEYS).openapi("AiObligationKey");
export const ProhibitedPracticeSchema = z.enum(PROHIBITED_PRACTICES).openapi("ProhibitedPractice");
export const AnnexIIIAreaSchema = z.enum(ANNEX_III_AREAS).openapi("AnnexIIIArea");
export const DerogationSchema = z.enum(DEROGATIONS).openapi("Derogation");
export const TransparencyDutySchema = z.enum(TRANSPARENCY_DUTIES).openapi("TransparencyDuty");
export const ClassificationSourceSchema = z
  .enum(["manual", "ai_assisted"])
  .openapi("ClassificationSource");

/**
 * The questionnaire's answers (spec §4). `profilesPeople` and `derogation` are required when
 * an Annex III area is chosen and must be null otherwise; lists hold no repeats. The rule is
 * `answerProblems` in @isms/domain, shared with the AI output schema.
 */
export const AiClassificationAnswers = z
  .object({
    isAiSystem: z.boolean(),
    prohibitedPractices: z.array(ProhibitedPracticeSchema).max(PROHIBITED_PRACTICES.length),
    annexISafetyComponent: z.boolean(),
    annexIIIAreas: z.array(AnnexIIIAreaSchema).max(ANNEX_III_AREAS.length),
    profilesPeople: z.boolean().nullable(),
    derogation: DerogationSchema.nullable(),
    transparency: z.array(TransparencyDutySchema).max(TRANSPARENCY_DUTIES.length),
  })
  .strict()
  .superRefine((answers, ctx) => {
    for (const { path, message } of answerProblems(answers))
      ctx.addIssue({ code: "custom", path: path.split("."), message });
  })
  .openapi("AiClassificationAnswers");
export type AiClassificationAnswers = z.infer<typeof AiClassificationAnswers>;

export const AiClassificationReasonDto = z
  .object({
    /** A machine code (`annex_iii.creditworthiness`); the web turns it into a sentence. */
    code: z.string(),
    /** For example `Art. 6(3)(a)` or `Annex III, point 5(b)`. */
    article: z.string(),
  })
  .openapi("AiClassificationReasonDto");

/** What `classifyAiSystem` decided on the server; never taken from the client. */
export const AiClassificationResultDto = z
  .object({
    riskClass: AiRiskClassSchema,
    transparencyDuties: z.array(TransparencyDutySchema),
    derogationApplied: z.boolean(),
    reasons: z.array(AiClassificationReasonDto),
  })
  .openapi("AiClassificationResultDto");
export type AiClassificationResultDto = z.infer<typeof AiClassificationResultDto>;

/** `AiSystem.classification` as stored (JSONB), checked on every read. */
export const AiClassificationRecord = z
  .object({
    version: z.literal(1),
    answers: AiClassificationAnswers,
    source: ClassificationSourceSchema,
    result: AiClassificationResultDto,
  })
  .strict();
export type AiClassificationRecord = z.infer<typeof AiClassificationRecord>;

export const AiClassificationDto = z
  .object({
    answers: AiClassificationAnswers,
    /** ai_assisted when the saved answers started from an AI draft. */
    source: ClassificationSourceSchema,
    result: AiClassificationResultDto,
    classifiedAt: z.iso.datetime(),
    classifiedBy: PersonRef,
  })
  .openapi("AiClassificationDto");
export type AiClassificationDto = z.infer<typeof AiClassificationDto>;

export const AiObligationDto = z
  .object({
    key: AiObligationKeySchema,
    article: z.string(),
    /** False once the obligation no longer follows from the class and role; its work is kept. */
    applicable: z.boolean(),
    status: AiObligationStatusSchema,
    note: z.string(),
    updatedAt: z.iso.datetime(),
    /** Null until a person changes the status or note. */
    updatedBy: PersonRef.nullable(),
  })
  .openapi("AiObligationDto");
export type AiObligationDto = z.infer<typeof AiObligationDto>;

/** A linked risk the viewer may see; links to other risks are left out entirely. */
export const AiSystemRiskDto = z
  .object({
    id: z.string(),
    /** R-0001 */
    reference: z.string(),
    title: z.string(),
    state: RiskStateSchema,
    linkedAt: z.iso.datetime(),
    linkedBy: PersonRef,
  })
  .openapi("AiSystemRiskDto");
export type AiSystemRiskDto = z.infer<typeof AiSystemRiskDto>;

export const AiSystemSummaryDto = z
  .object({
    id: z.string(),
    name: z.string(),
    role: AiActRoleSchema,
    status: AiSystemStatusSchema,
    riskClass: AiSystemRiskClassSchema,
    owner: PersonRef,
    department: DepartmentDto.nullable(),
    /** Applicable obligations still open or in progress. */
    openObligationCount: z.number().int().nonnegative(),
    updatedAt: z.iso.datetime(),
  })
  .openapi("AiSystemSummaryDto");
export type AiSystemSummaryDto = z.infer<typeof AiSystemSummaryDto>;

export const AiSystemListResponse = z
  .object({ systems: z.array(AiSystemSummaryDto) })
  .openapi("AiSystemListResponse");
export type AiSystemListResponse = z.infer<typeof AiSystemListResponse>;

export const AiSystemDetailDto = AiSystemSummaryDto.extend({
  description: z.string(),
  intendedPurpose: z.string(),
  supplier: z.string().nullable(),
  model: z.string().nullable(),
  usesGeneralPurposeModel: z.boolean(),
  createdAt: z.iso.datetime(),
  /** Null while unclassified. */
  classification: AiClassificationDto.nullable(),
  /** Applicable first, then the ones that no longer apply; each in catalogue order. */
  obligations: z.array(AiObligationDto),
  /** Empty without risks.read. */
  risks: z.array(AiSystemRiskDto),
  /** The viewer holds aiact.manage and ai_act_classification is ready. */
  canDraftClassification: z.boolean(),
  /** The viewer holds aiact.manage and ai_act_obligation_guidance is ready. */
  canSuggestGuidance: z.boolean(),
}).openapi("AiSystemDetailDto");
export type AiSystemDetailDto = z.infer<typeof AiSystemDetailDto>;
