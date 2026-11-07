import type { Prisma } from "@isms/database";
import { type RiskState, type Treatment, formatRiskReference } from "@isms/domain";

/** A `Risk` row as the generator writes it (every column set). */
export type RiskRow = {
  id: string;
  reference: number;
  version: number;
  title: string;
  scenario: string;
  threat: string;
  consequence: string;
  existingSafeguards: string;
  toConfirm: string[];
  likelihood: number | null;
  impact: number | null;
  residualLikelihood: number | null;
  residualImpact: number | null;
  riskScaleId: string | null;
  aiLikelihood: number | null;
  aiImpact: number | null;
  aiReasoning: string | null;
  treatment: Treatment | null;
  treatmentNote: string;
  state: RiskState;
  ownerId: string | null;
  reporterId: string;
  reviewerId: string | null;
  submittedAt: Date | null;
  approvedAt: Date | null;
  closedAt: Date | null;
  closedById: string | null;
  nextReviewDue: Date | null;
  siteId: string | null;
  departmentId: string | null;
  aiAssisted: boolean;
  controlSuggestion: "none";
  createdAt: Date;
  updatedAt: Date;
};

/** The fields of a risk the snapshot reads; a Prisma `Risk` row fits too. */
type Versioned = Omit<
  RiskRow,
  "id" | "version" | "submittedAt" | "approvedAt" | "controlSuggestion" | "createdAt" | "updatedAt"
> & { treatment: string | null; state: string };

/**
 * The snapshot `writeVersion` (apps/api/src/risks/risk-versions.ts) stores: explicit domain
 * fields, the affected assets sorted by name then type, the accepted controls' codes sorted,
 * and the lifecycle note only when given. Kept key for key; the parity test checks it.
 */
export function versionSnapshot(
  r: Versioned,
  assets: readonly { name: string; type: string }[],
  controls: readonly string[],
  lifecycleNote?: string,
): Prisma.InputJsonObject {
  return {
    reference: formatRiskReference(r.reference),
    title: r.title,
    scenario: r.scenario,
    threat: r.threat,
    consequence: r.consequence,
    existingSafeguards: r.existingSafeguards,
    toConfirm: [...r.toConfirm],
    likelihood: r.likelihood,
    impact: r.impact,
    residualLikelihood: r.residualLikelihood,
    residualImpact: r.residualImpact,
    riskScaleId: r.riskScaleId,
    aiLikelihood: r.aiLikelihood,
    aiImpact: r.aiImpact,
    aiReasoning: r.aiReasoning,
    treatment: r.treatment,
    treatmentNote: r.treatmentNote,
    state: r.state,
    ownerId: r.ownerId,
    reporterId: r.reporterId,
    reviewerId: r.reviewerId,
    siteId: r.siteId,
    departmentId: r.departmentId,
    aiAssisted: r.aiAssisted,
    closedAt: r.closedAt?.toISOString() ?? null,
    closedById: r.closedById,
    nextReviewDue: r.nextReviewDue?.toISOString().slice(0, 10) ?? null,
    assets: assets
      .map((a) => ({ name: a.name, type: a.type }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type)),
    controls: [...controls].sort(),
    ...(lifecycleNote === undefined ? {} : { lifecycleNote }),
  };
}
