import type { Prisma } from "@isms/database";
import { formatRiskReference } from "@isms/domain";

type Tx = Prisma.TransactionClient;

/** The risk's own fields a version snapshot records (relations are read separately). */
export type VersionedRisk = {
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
  treatment: string | null;
  treatmentNote: string;
  state: string;
  ownerId: string | null;
  reporterId: string;
  reviewerId: string | null;
  siteId: string | null;
  departmentId: string | null;
  aiAssisted: boolean;
  closedAt: Date | null;
  closedById: string | null;
  nextReviewDue: Date | null;
};

/**
 * Appends the immutable snapshot of `riskAfter` at its (already incremented) version
 * (P3-R3). The snapshot names explicit domain fields only, plus the affected assets' names
 * and the accepted controls' codes, read in the same transaction.
 */
export async function writeVersion(
  tx: Tx,
  riskAfter: VersionedRisk,
  changedFields: readonly string[],
  actorId: string,
  /** The reason or note of a lifecycle action; stored in the snapshot only when given. */
  lifecycleNote?: string,
): Promise<void> {
  // One query at a time: a transaction client runs on a single connection.
  const assets = await tx.riskAsset.findMany({
    where: { riskId: riskAfter.id },
    select: { asset: { select: { name: true, type: true } } },
  });
  const controls = await tx.riskControl.findMany({
    where: { riskId: riskAfter.id, status: "accepted" },
    select: { control: { select: { code: true } } },
  });
  const r = riskAfter;
  const snapshot = {
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
      .map((a) => ({ name: a.asset.name, type: a.asset.type }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type)),
    controls: controls.map((c) => c.control.code).sort(),
    ...(lifecycleNote === undefined ? {} : { lifecycleNote }),
  } satisfies Prisma.InputJsonObject;
  await tx.riskVersion.create({
    data: {
      riskId: r.id,
      version: r.version,
      snapshot,
      changedFields: [...changedFields],
      changedById: actorId,
    },
    select: { id: true },
  });
}
