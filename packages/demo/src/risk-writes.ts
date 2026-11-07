import { approvalRule, formatRiskReference, reviewDueDate } from "@isms/domain";
import { type Builder, type Json, lengthOf } from "./builder.js";
import { SAMPLE_APPETITE_THRESHOLD } from "./company.js";
import { type RiskRow, versionSnapshot } from "./snapshot.js";
import { departmentId, siteId } from "./setup.js";
import { dateOnly } from "./time.js";
import type { AssetRef, RiskChanges, SampleEvent } from "./types.js";

export type RiskEvent = Extract<SampleEvent, { risk: string }>;

/** A risk as the replay knows it: its row, affected assets, accepted controls and evidence. */
export type RiskEntry = {
  row: RiskRow;
  assets: AssetRef[];
  controls: Map<string, string>;
  evidence: { id: string; sha256: string }[];
};

/** The approval rule `ruleOf` (approval-readiness.ts) gives at the sample appetite. */
export function ruleOf(r: RiskRow) {
  if (r.likelihood === null || r.impact === null || r.treatment === null)
    return "independentApprover";
  return approvalRule({
    likelihood: r.likelihood,
    impact: r.impact,
    treatment: r.treatment,
    appetiteThreshold: SAMPLE_APPETITE_THRESHOLD,
  });
}
export type RiskBook = Map<string, RiskEntry>;
export type ReplayState = {
  reference: number;
  scaleId: string;
  reviewMonths: number;
  keys: Map<string, string>;
  /** Asset ids by "nameKey|type", reused across risks like `resolveAssets`. */
  assets: Map<string, string>;
};

/** RiskEditService's PLAIN_FIELDS, in its order (the order of `changedFields`). */
const PLAIN_FIELDS = [
  "title",
  "scenario",
  "threat",
  "consequence",
  "existingSafeguards",
  "toConfirm",
  "likelihood",
  "impact",
  "residualLikelihood",
  "residualImpact",
  "treatment",
  "treatmentNote",
  "ownerId",
  "siteId",
  "departmentId",
] as const;
const TEXT_FIELDS = new Set([
  "title",
  "scenario",
  "threat",
  "consequence",
  "existingSafeguards",
  "treatmentNote",
]);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** `fieldAudit` (risk-edit-audit.ts): free text by length, toConfirm by count. */
function fieldAudit(
  field: string,
  before: unknown,
  next: unknown,
): { before?: Json | null; after: Json | null } {
  if (TEXT_FIELDS.has(field))
    return { after: { changed: true, length: typeof next === "string" ? next.length : 0 } };
  if (field === "toConfirm")
    return {
      before: { count: Array.isArray(before) ? before.length : 0 },
      after: { count: Array.isArray(next) ? next.length : 0 },
    };
  return { before: before as Json | null, after: next as Json | null };
}

/** `writeVersion`: the snapshot of the risk at its (already raised) version. */
export function writeVersion(
  b: Builder,
  r: RiskEntry,
  at: Date,
  changed: string[],
  actor: string,
  note?: string,
) {
  b.rows.riskVersions.push({
    id: b.id(at),
    riskId: r.row.id,
    version: r.row.version,
    snapshot: versionSnapshot(r.row, r.assets, [...r.controls.keys()], note),
    changedFields: [...changed],
    changedById: actor,
    createdAt: at,
  });
}

export const openReviewTasks = (b: Builder, riskId: string) =>
  b.rows.tasks
    .filter((t) => t.riskId === riskId && t.kind === "periodic_review" && t.status === "open")
    .sort((x, y) => x.id.localeCompare(y.id));

/** `completeOpenReviewTasks` (review-tasks.ts). */
export function completeReviews(b: Builder, riskId: string, at: Date, actor: string, note: string) {
  for (const task of openReviewTasks(b, riskId)) {
    Object.assign(task, {
      status: "done",
      completedAt: at,
      completedById: actor,
      completionNote: note,
      updatedAt: at,
    });
    b.audit(
      at,
      actor,
      "task.completed",
      "Task",
      task.id,
      { status: "done", riskId, note: lengthOf(note) },
      { status: "open" },
    );
  }
}

export const task = (b: Builder, id: string) => {
  const found = b.rows.tasks.find((t) => t.id === id);
  if (!found) throw new Error(`unknown task ${id}`);
  return found;
};

export function report(
  b: Builder,
  book: RiskBook,
  s: ReplayState,
  e: Extract<RiskEvent, { kind: "report" }>,
  actor: string,
) {
  s.reference += 1;
  const row: RiskRow = {
    id: b.id(e.at),
    reference: s.reference,
    version: 1,
    title: e.title,
    scenario: e.scenario,
    threat: e.threat,
    consequence: e.consequence,
    existingSafeguards: e.existingSafeguards,
    toConfirm: [...e.toConfirm],
    likelihood: null,
    impact: null,
    residualLikelihood: null,
    residualImpact: null,
    riskScaleId: null,
    aiLikelihood: null,
    aiImpact: null,
    aiReasoning: null,
    treatment: null,
    treatmentNote: "",
    state: "proposed",
    ownerId: null,
    reporterId: actor,
    reviewerId: null,
    submittedAt: null,
    approvedAt: null,
    closedAt: null,
    closedById: null,
    nextReviewDue: null,
    siteId: e.site === null ? null : siteId(b, e.site),
    departmentId: e.department === null ? null : departmentId(b, e.department),
    aiAssisted: false,
    controlSuggestion: "none",
    createdAt: e.at,
    updatedAt: e.at,
  };
  const entry: RiskEntry = { row, assets: [], controls: new Map(), evidence: [] };
  book.set(e.risk, entry);
  for (const asset of e.assets) {
    const key = `${asset.name.trim().toLowerCase()}|${asset.type}`;
    let assetId = s.assets.get(key);
    if (assetId === undefined) {
      assetId = b.id(e.at);
      s.assets.set(key, assetId);
      b.rows.assets.push({
        id: assetId,
        name: asset.name,
        nameKey: asset.name.trim().toLowerCase(),
        type: asset.type,
        siteId: row.siteId,
        ownerId: null,
        createdAt: e.at,
        updatedAt: e.at,
      });
    }
    if (b.rows.riskAssets.some((x) => x.riskId === row.id && x.assetId === assetId)) continue;
    b.rows.riskAssets.push({ riskId: row.id, assetId });
    entry.assets.push(asset);
  }
  writeVersion(b, entry, e.at, [], actor);
  b.audit(e.at, actor, "risk.reported", "Risk", row.id, {
    reference: formatRiskReference(row.reference),
    titleLength: row.title.length,
    aiAssisted: false,
  });
}

/** RiskEditService.update: real differences only, accept clears the expected score. */
export function edit(
  b: Builder,
  r: RiskEntry,
  s: ReplayState,
  at: Date,
  actor: string,
  changes: RiskChanges,
) {
  const next: Record<string, unknown> = {
    ...changes,
    ...(changes.owner === undefined ? {} : { ownerId: b.user(changes.owner) }),
  };
  const row = r.row as unknown as Record<string, unknown>;
  const changed: string[] = [];
  const data: Record<string, unknown> = {};
  const before: Record<string, Json | null> = {};
  const after: Record<string, Json | null> = {};
  for (const field of PLAIN_FIELDS) {
    const value = next[field];
    if (value === undefined || same(row[field], value)) continue;
    changed.push(field);
    data[field] = value;
    const entry = fieldAudit(field, row[field], value);
    if ("before" in entry) before[field] = entry.before ?? null;
    after[field] = entry.after;
  }
  if (changes.treatment === "accept")
    for (const field of ["residualLikelihood", "residualImpact"] as const) {
      if (r.row[field] === null || next[field] != null || changed.includes(field)) continue;
      changed.push(field);
      data[field] = null;
      before[field] = r.row[field];
      after[field] = null;
    }
  if (changed.length === 0) return;
  if (changed.includes("likelihood") || changed.includes("impact")) data["riskScaleId"] = s.scaleId;
  const old = r.row.version;
  Object.assign(r.row, data, { version: old + 1, updatedAt: at });
  writeVersion(b, r, at, changed, actor);
  b.audit(
    at,
    actor,
    "risk.updated",
    "Risk",
    r.row.id,
    { version: r.row.version, ...after },
    { version: old, ...before },
  );
}

/** ApprovalService.decide: the Approval row, the state change, then the audit. */
export function decide(
  b: Builder,
  r: RiskEntry,
  s: ReplayState,
  at: Date,
  actor: string,
  action: "approve" | "return",
  comment: string,
) {
  const row = r.row;
  const latest = b.rows.riskVersions.findLast(
    (v) => v.riskId === row.id && v.version === row.version,
  );
  if (!latest) throw new Error("no version to decide");
  const approvalId = b.id(at);
  b.rows.approvals.push({
    id: approvalId,
    riskId: row.id,
    version: row.version,
    decision: action === "approve" ? "approved" : "returned",
    comment,
    approverId: actor,
    createdAt: at,
    snapshot: {
      ...(latest.snapshot as Record<string, Json>),
      version: row.version,
      evidence: [...r.evidence].sort((x, y) => x.id.localeCompare(y.id)),
    },
  });
  const was = { state: row.state, version: row.version };
  const rule = ruleOf(row);
  Object.assign(row, {
    state: action === "approve" ? "approved" : "returned",
    version: row.version + 1,
    updatedAt: at,
  });
  if (action === "approve")
    Object.assign(row, {
      approvedAt: at,
      nextReviewDue: dateOnly(reviewDueDate(at, s.reviewMonths)),
    });
  writeVersion(b, r, at, action === "approve" ? ["state", "nextReviewDue"] : ["state"], actor);
  if (action === "approve") completeReviews(b, row.id, at, actor, "");
  b.audit(
    at,
    actor,
    action === "approve" ? "risk.approved" : "risk.returned",
    "Risk",
    row.id,
    {
      state: row.state,
      version: row.version,
      decidedVersion: was.version,
      approvalId,
      rule,
      comment: lengthOf(comment),
    },
    was,
  );
}
