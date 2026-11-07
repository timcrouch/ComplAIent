import { JOURNEY_STEPS, RISK_STATES, TREATMENTS } from "@isms/domain";
import { z } from "zod";
import "../zod.js";

export const PersonRef = z.object({ id: z.string(), displayName: z.string() }).openapi("PersonRef");
export type PersonRef = z.infer<typeof PersonRef>;

export const RiskStateSchema = z.enum(RISK_STATES).openapi("RiskState");
export const TreatmentSchema = z.enum(TREATMENTS).openapi("Treatment");
export const AssetTypeSchema = z
  .enum(["information", "application", "device", "service", "facility", "other"])
  .openapi("AssetType");
export type AssetType = z.infer<typeof AssetTypeSchema>;

export const RiskSummaryDto = z
  .object({
    id: z.string(),
    /** R-0001 */
    reference: z.string(),
    title: z.string(),
    state: RiskStateSchema,
    /** likelihood × impact; null until both are set. */
    score: z.number().int().nullable(),
    /** Against the current appetite; null while unscored. */
    aboveAppetite: z.boolean().nullable(),
    /** Expected score after treatment. An accepted risk's equals its inherent score; null only when a non-accepted risk lacks a residual field, or the risk is unscored. */
    residualScore: z.number().int().nullable(),
    /** Against the current appetite; null while residualScore is null. */
    residualAboveAppetite: z.boolean().nullable(),
    owner: PersonRef.nullable(),
    siteName: z.string().nullable(),
    updatedAt: z.iso.datetime(),
  })
  .openapi("RiskSummaryDto");
export type RiskSummaryDto = z.infer<typeof RiskSummaryDto>;

export const RiskControlDto = z
  .object({
    /** This control's place on the risk (decisions and removal use it). */
    id: z.string(),
    /** The library control: evidence and evidence requests name it. */
    controlId: z.string(),
    code: z.string(),
    title: z.string(),
    status: z.enum(["suggested", "accepted", "rejected"]),
    reason: z.string(),
    source: z.enum(["ai", "person"]),
    suggestedBy: PersonRef.nullable(),
    decidedBy: PersonRef.nullable(),
    decidedAt: z.iso.datetime().nullable(),
    refs: z.array(z.object({ framework: z.string(), ref: z.string() })),
    evidenceCount: z.number().int(),
  })
  .openapi("RiskControlDto");
export type RiskControlDto = z.infer<typeof RiskControlDto>;

export const ControlSuggestionStatusSchema = z
  .enum(["none", "pending", "ready", "failed"])
  .openapi("ControlSuggestionStatus");
export const ControlSuggestionDto = z
  .object({
    status: ControlSuggestionStatusSchema,
    failure: z.string().nullable(),
  })
  .openapi("ControlSuggestionDto");
export type ControlSuggestionDto = z.infer<typeof ControlSuggestionDto>;

export const EvidenceClassificationSchema = z
  .enum(["internal", "confidential", "restricted"])
  .openapi("EvidenceClassification");

/** Immutable once stored (P3-R12); newest first on a risk. */
export const EvidenceDto = z
  .object({
    id: z.string(),
    fileName: z.string(),
    sha256: z.string(),
    sizeBytes: z.number().int(),
    mimeType: z.string(),
    classification: EvidenceClassificationSchema,
    uploadedBy: PersonRef,
    collectedAt: z.iso.datetime(),
    controls: z.array(z.object({ code: z.string(), title: z.string() })),
  })
  .openapi("EvidenceDto");
export type EvidenceDto = z.infer<typeof EvidenceDto>;

export const RiskHistoryEntryDto = z
  .object({
    version: z.number().int(),
    changedFields: z.array(z.string()),
    changedBy: PersonRef,
    at: z.iso.datetime(),
  })
  .openapi("RiskHistoryEntryDto");

export const ApprovalRuleSchema = z
  .enum(["reviewerMayApprove", "independentApprover"])
  .openapi("ApprovalRule");
export const ApprovalRefusalSchema = z
  .enum(["reporter", "reviewerNeedsIndependent", "notApprover"])
  .openapi("ApprovalRefusal");

/** One decision on a submitted version, oldest first. */
export const ApprovalDecisionDto = z
  .object({
    decision: z.enum(["approved", "returned"]),
    approver: PersonRef,
    comment: z.string(),
    /** The version that was approved or returned. */
    version: z.number().int(),
    at: z.iso.datetime(),
  })
  .openapi("ApprovalDecisionDto");
export type ApprovalDecisionDto = z.infer<typeof ApprovalDecisionDto>;

/** Who may approve a submitted risk (P3-R4); present once the risk has been submitted. */
export const ApprovalReadinessDto = z
  .object({
    rule: ApprovalRuleSchema,
    reviewer: PersonRef,
    /** Users who may approve it now: approvers in its scope less the reporter and the reviewer, plus the reviewer when the rule lets them (no approver role needed then). */
    eligibleApproverCount: z.number().int(),
    noEligibleApprover: z.boolean(),
    /** Why the caller may not approve it; null when they may. */
    viewerRefusal: ApprovalRefusalSchema.nullable(),
    decisions: z.array(ApprovalDecisionDto),
  })
  .openapi("ApprovalReadinessDto");
export type ApprovalReadinessDto = z.infer<typeof ApprovalReadinessDto>;

export const JourneyStepDto = z
  .object({
    key: z.enum(JOURNEY_STEPS),
    status: z.enum(["done", "current", "upcoming"]),
    at: z.iso.datetime().nullable(),
    by: PersonRef.nullable(),
  })
  .openapi("JourneyStepDto");
export type JourneyStepDto = z.infer<typeof JourneyStepDto>;

export const JourneyWaitingDto = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("owner"), owner: PersonRef.nullable() }),
    z.object({
      kind: z.literal("approver"),
      rule: ApprovalRuleSchema,
      reviewer: PersonRef,
      /** At most 5, ordered by display name. */
      eligibleApprovers: z.array(PersonRef).max(5),
      eligibleApproverCount: z.number().int(),
      noEligibleApprover: z.boolean(),
    }),
    z.object({ kind: z.literal("none") }),
    /** Approved or closed: waiting for the next periodic review (YYYY-MM-DD). */
    z.object({ kind: z.literal("review"), nextReviewDue: z.iso.date().nullable() }),
  ])
  .openapi("JourneyWaitingDto");
export type JourneyWaitingDto = z.infer<typeof JourneyWaitingDto>;

/** Where a risk is on its way to approval, derived from its records. */
export const RiskJourneyDto = z
  .object({
    steps: z.array(JourneyStepDto),
    since: z.iso.datetime(),
    waitingOn: JourneyWaitingDto,
    returnCount: z.number().int(),
    /** "reassessed" once the risk has been reassessed after approval or closing. */
    cycle: z.enum(["first", "reassessed"]),
    /** Oldest first. */
    returns: z.array(z.object({ at: z.iso.datetime(), by: PersonRef, comment: z.string() })),
  })
  .openapi("RiskJourneyDto");
export type RiskJourneyDto = z.infer<typeof RiskJourneyDto>;

export const TaskStatusSchema = z.enum(["open", "done", "cancelled"]).openapi("TaskStatus");

/** One treatment action on a risk's treatment plan. */
export const TreatmentActionDto = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    assignee: PersonRef,
    dueDate: z.iso.date().nullable(),
    status: TaskStatusSchema,
    /** Open and past its due date. */
    overdue: z.boolean(),
    control: z.object({ code: z.string(), title: z.string() }).nullable(),
    completedAt: z.iso.datetime().nullable(),
    completedBy: PersonRef.nullable(),
    completionNote: z.string(),
    cancelledReason: z.string(),
  })
  .openapi("TreatmentActionDto");
export type TreatmentActionDto = z.infer<typeof TreatmentActionDto>;

/** Open actions first by due date, then done and cancelled ones, newest first. */
export const TreatmentPlanDto = z
  .object({
    actions: z.array(TreatmentActionDto),
    open: z.number().int(),
    done: z.number().int(),
    overdue: z.number().int(),
  })
  .openapi("TreatmentPlanDto");
export type TreatmentPlanDto = z.infer<typeof TreatmentPlanDto>;

export const RiskDetailDto = RiskSummaryDto.extend({
  scenario: z.string(),
  threat: z.string(),
  consequence: z.string(),
  existingSafeguards: z.string(),
  toConfirm: z.array(z.string()),
  assets: z.array(z.object({ id: z.string(), name: z.string(), type: AssetTypeSchema })),
  likelihood: z.number().int().nullable(),
  impact: z.number().int().nullable(),
  /** Expected after treatment (1-5); null when not assessed. */
  residualLikelihood: z.number().int().nullable(),
  residualImpact: z.number().int().nullable(),
  /** The AI's estimate, never the official assessment (P3-R5). */
  aiEstimate: z
    .object({
      likelihood: z.number().int(),
      impact: z.number().int(),
      reasoning: z.string(),
    })
    .nullable(),
  treatment: TreatmentSchema.nullable(),
  treatmentNote: z.string(),
  version: z.number().int(),
  reporter: PersonRef,
  reviewer: PersonRef.nullable(),
  closedAt: z.iso.datetime().nullable(),
  closedBy: PersonRef.nullable(),
  /** The next periodic review (YYYY-MM-DD); null until the risk is approved. */
  nextReviewDue: z.iso.date().nullable(),
  /** Approved or closed, and the review date is today or earlier (UTC); decided by the API. */
  reviewDue: z.boolean(),
  siteId: z.string().nullable(),
  departmentId: z.string().nullable(),
  aiAssisted: z.boolean(),
  hasTranscript: z.boolean(),
  controls: z.array(RiskControlDto),
  controlSuggestion: ControlSuggestionDto,
  evidence: z.array(EvidenceDto),
  /** Null while proposed and never submitted. */
  approval: ApprovalReadinessDto.nullable(),
  journey: RiskJourneyDto,
  treatmentPlan: TreatmentPlanDto,
  /** Newest first. */
  history: z.array(RiskHistoryEntryDto),
  can: z.object({
    edit: z.boolean(),
    submit: z.boolean(),
    approve: z.boolean(),
    return: z.boolean(),
    /** Mark as treated: approved, no open treatment actions. */
    close: z.boolean(),
    /** Approved or closed. */
    reassess: z.boolean(),
    /** Approved or closed. */
    confirmReview: z.boolean(),
    addEvidence: z.boolean(),
    /** Add treatment actions: a reviewer, and the risk is not closed and its treatment is not accept. */
    planActions: z.boolean(),
    readTranscript: z.boolean(),
    /** Edit, and the AI can suggest controls now; false with AI off (add from the library). */
    suggestControls: z.boolean(),
  }),
}).openapi("RiskDetailDto");
export type RiskDetailDto = z.infer<typeof RiskDetailDto>;
