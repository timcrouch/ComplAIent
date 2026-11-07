import type {
  ApprovalDecisionDto,
  ApprovalReadinessDto,
  EvidenceDto,
  RiskControlDto,
  RiskDetailDto,
  RiskJourneyDto,
  RiskSummaryDto,
  TreatmentPlanDto,
} from "@isms/contracts";
import type { Prisma } from "@isms/database";
import {
  formatRiskReference,
  isAboveAppetite,
  isReviewDue,
  isoDateUtc,
  mapPosition,
  riskScore,
} from "@isms/domain";
import type { ResourceScope } from "../authorization/index.js";

const PERSON = { select: { id: true, displayName: true } } as const;

/** The 1–5 levels of each axis (the column check constraints). */
export const LEVELS = [1, 2, 3, 4, 5] as const;

/** One evidence file as the API shows it; its controls in code order. */
export const EVIDENCE_SELECT = {
  id: true,
  fileName: true,
  sha256: true,
  sizeBytes: true,
  mimeType: true,
  classification: true,
  collectedAt: true,
  uploadedBy: PERSON,
  controls: {
    select: { controlId: true, control: { select: { code: true, title: true } } },
    orderBy: { control: { code: "asc" } },
  },
} as const satisfies Prisma.EvidenceSelect;

export type EvidenceRow = Prisma.EvidenceGetPayload<{ select: typeof EVIDENCE_SELECT }>;

export function toEvidence(e: EvidenceRow): EvidenceDto {
  return {
    id: e.id,
    fileName: e.fileName,
    sha256: e.sha256,
    sizeBytes: e.sizeBytes,
    mimeType: e.mimeType,
    classification: e.classification,
    uploadedBy: e.uploadedBy,
    collectedAt: e.collectedAt.toISOString(),
    controls: e.controls.map((c) => ({ code: c.control.code, title: c.control.title })),
  };
}

export const RISK_SUMMARY_SELECT = {
  id: true,
  reference: true,
  title: true,
  state: true,
  likelihood: true,
  impact: true,
  residualLikelihood: true,
  residualImpact: true,
  treatment: true,
  siteId: true,
  departmentId: true,
  updatedAt: true,
  owner: PERSON,
  site: { select: { name: true } },
} as const satisfies Prisma.RiskSelect;

export const RISK_DETAIL_SELECT = {
  ...RISK_SUMMARY_SELECT,
  scenario: true,
  threat: true,
  consequence: true,
  existingSafeguards: true,
  toConfirm: true,
  riskScaleId: true,
  aiLikelihood: true,
  aiImpact: true,
  aiReasoning: true,
  treatmentNote: true,
  version: true,
  ownerId: true,
  reporterId: true,
  reviewerId: true,
  aiAssisted: true,
  reporter: PERSON,
  reviewer: PERSON,
  closedAt: true,
  closedBy: PERSON,
  nextReviewDue: true,
  assets: {
    select: { asset: { select: { id: true, name: true, type: true } } },
    orderBy: { asset: { nameKey: "asc" } },
  },
  versions: {
    select: {
      version: true,
      changedFields: true,
      createdAt: true,
      changedBy: PERSON,
    },
    orderBy: { version: "desc" },
  },
  conversation: { select: { id: true, reporterId: true } },
  /** Decisions on submitted versions, oldest first. */
  approvals: {
    select: { decision: true, comment: true, version: true, createdAt: true, approver: PERSON },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
  controlSuggestion: true,
  controlSuggestionFailure: true,
  controls: {
    select: {
      id: true,
      controlId: true,
      status: true,
      reason: true,
      source: true,
      aiInteractionId: true,
      decidedAt: true,
      suggestedBy: PERSON,
      decidedBy: PERSON,
      control: {
        select: {
          code: true,
          title: true,
          mappings: {
            select: {
              requirement: {
                select: {
                  ref: true,
                  sortOrder: true,
                  frameworkVersion: {
                    select: { framework: { select: { name: true } } },
                  },
                },
              },
            },
          },
        },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
  /** Newest first; also counted per control. */
  evidence: { select: EVIDENCE_SELECT, orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
} as const satisfies Prisma.RiskSelect;

export type RiskSummaryRow = Prisma.RiskGetPayload<{
  select: typeof RISK_SUMMARY_SELECT;
}>;
/** A risk as the services read it: its fields and what the detail view shows. */
export type RiskRow = Prisma.RiskGetPayload<{
  select: typeof RISK_DETAIL_SELECT;
}>;

/** The organisational unit a risk belongs to, for scope checks. */
export function riskScope(r: {
  siteId: string | null;
  departmentId: string | null;
}): ResourceScope {
  return {
    ...(r.siteId === null ? {} : { siteId: r.siteId }),
    ...(r.departmentId === null ? {} : { departmentId: r.departmentId }),
  };
}

export function toSummary(r: RiskSummaryRow, appetiteThreshold: number): RiskSummaryDto {
  const score =
    r.likelihood === null || r.impact === null ? null : riskScore(r.likelihood, r.impact);
  const residual = mapPosition(r, "residual");
  const residualScore = residual === null ? null : riskScore(residual.likelihood, residual.impact);
  return {
    id: r.id,
    reference: formatRiskReference(r.reference),
    title: r.title,
    state: r.state,
    score,
    aboveAppetite: score === null ? null : isAboveAppetite(score, appetiteThreshold),
    residualScore,
    residualAboveAppetite:
      residualScore === null ? null : isAboveAppetite(residualScore, appetiteThreshold),
    owner: r.owner,
    siteName: r.site?.name ?? null,
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toControls(r: RiskRow): RiskControlDto[] {
  const counts = new Map<string, number>();
  for (const e of r.evidence)
    for (const c of e.controls) counts.set(c.controlId, (counts.get(c.controlId) ?? 0) + 1);
  return r.controls.map((c) => ({
    id: c.id,
    controlId: c.controlId,
    code: c.control.code,
    title: c.control.title,
    status: c.status,
    reason: c.reason,
    source: c.source,
    suggestedBy: c.suggestedBy,
    decidedBy: c.decidedBy,
    decidedAt: c.decidedAt?.toISOString() ?? null,
    refs: c.control.mappings
      .map((m) => m.requirement)
      .sort(
        (a, b) =>
          a.frameworkVersion.framework.name.localeCompare(b.frameworkVersion.framework.name) ||
          a.sortOrder - b.sortOrder,
      )
      .map((q) => ({
        framework: q.frameworkVersion.framework.name,
        ref: q.ref,
      })),
    evidenceCount: counts.get(c.controlId) ?? 0,
  }));
}

export function toDecisions(r: RiskRow): ApprovalDecisionDto[] {
  return r.approvals.map((a) => ({
    decision: a.decision,
    approver: a.approver,
    comment: a.comment,
    version: a.version,
    at: a.createdAt.toISOString(),
  }));
}

export function toDetail(
  r: RiskRow,
  appetiteThreshold: number,
  can: RiskDetailDto["can"],
  approval: ApprovalReadinessDto | null,
  journey: RiskJourneyDto,
  treatmentPlan: TreatmentPlanDto,
): RiskDetailDto {
  return {
    ...toSummary(r, appetiteThreshold),
    scenario: r.scenario,
    threat: r.threat,
    consequence: r.consequence,
    existingSafeguards: r.existingSafeguards,
    toConfirm: [...r.toConfirm],
    assets: r.assets.map((a) => ({ ...a.asset })),
    likelihood: r.likelihood,
    impact: r.impact,
    residualLikelihood: r.residualLikelihood,
    residualImpact: r.residualImpact,
    aiEstimate:
      r.aiLikelihood === null || r.aiImpact === null
        ? null
        : {
            likelihood: r.aiLikelihood,
            impact: r.aiImpact,
            reasoning: r.aiReasoning ?? "",
          },
    treatment: r.treatment,
    treatmentNote: r.treatmentNote,
    version: r.version,
    reporter: r.reporter,
    reviewer: r.reviewer,
    closedAt: r.closedAt?.toISOString() ?? null,
    closedBy: r.closedBy,
    nextReviewDue: r.nextReviewDue === null ? null : isoDateUtc(r.nextReviewDue),
    reviewDue:
      (r.state === "approved" || r.state === "closed") &&
      r.nextReviewDue !== null &&
      isReviewDue(isoDateUtc(r.nextReviewDue), isoDateUtc(new Date())),
    siteId: r.siteId,
    departmentId: r.departmentId,
    aiAssisted: r.aiAssisted,
    hasTranscript: r.conversation !== null,
    controls: toControls(r),
    controlSuggestion: {
      status: r.controlSuggestion,
      failure: r.controlSuggestionFailure,
    },
    evidence: r.evidence.map(toEvidence),
    approval,
    journey,
    treatmentPlan,
    history: r.versions.map((v) => ({
      version: v.version,
      changedFields: [...v.changedFields],
      changedBy: v.changedBy,
      at: v.createdAt.toISOString(),
    })),
    can,
  };
}
