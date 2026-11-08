import { writeAiAct } from "./ai-act.js";
import { Builder, emptyRows, idMaker, lengthOf } from "./builder.js";
import { SAMPLE_ORGANISATION, SAMPLE_SEED } from "./company.js";
import { type RiskBook, applyRiskEvent, openReviewTasks } from "./risk-events.js";
import { writeIdentities, writePeople, writeSetup } from "./setup.js";
import { SETUP_DAYS_AGO } from "./year.js";
import { DAY, MINUTE, dateOnly, isoDay, startOfDay } from "./time.js";
import type { RowsContext, SampleEvent, SamplePlan, SampleRows } from "./types.js";

/** Separate id streams: the loader-dependent rows must not shift anyone else's ids. */
const EXTRAS_SEED_OFFSET = 7919;
/** The EU AI Act module's own id stream, so adding it shifted no other row's id. */
const AI_ACT_SEED_OFFSET = 104_729;

/**
 * The worker's `risk.review_due` (apps/worker/src/jobs/review-due.ts), run each day up to
 * `until`: an open "Review this risk" task for every approved or closed risk with an owner whose
 * review is due, created early on its due day. It writes no audit row, nor does the worker.
 */
function runReviewDue(b: Builder, book: RiskBook, until: number): void {
  const today = isoDay(until);
  for (const r of book.values()) {
    const row = r.row;
    if (row.state !== "approved" && row.state !== "closed") continue;
    if (row.ownerId === null || row.nextReviewDue === null) continue;
    const due = isoDay(row.nextReviewDue.getTime());
    if (due > today || openReviewTasks(b, row.id).length > 0) continue;
    const created = new Date(Math.min(row.nextReviewDue.getTime() + 5 * MINUTE, until));
    b.rows.tasks.push({
      id: b.id(created),
      kind: "periodic_review",
      title: "Review this risk",
      description: "",
      assigneeId: row.ownerId,
      requestedById: row.ownerId,
      dueDate: dateOnly(due),
      status: "open",
      riskId: row.id,
      controlId: null,
      completedAt: null,
      completionNote: "",
      completedById: null,
      cancelledReason: "",
      cancelledById: null,
      createdAt: created,
      updatedAt: created,
    });
  }
}

/** Events that are not about one risk. */
function applyOther(
  b: Builder,
  e: Exclude<SampleEvent, { risk: string }>,
  keys: Map<string, string>,
) {
  const by = b.user(e.by);
  switch (e.kind) {
    case "control_test": {
      const id = b.id(e.at);
      const evidence = e.evidence.map((key) => {
        const evidenceId = keys.get(key);
        if (evidenceId === undefined) throw new Error(`unknown evidence ${key}`);
        return evidenceId;
      });
      b.rows.controlTests.push({
        id,
        controlId: b.control(e.control),
        testedOn: dateOnly(e.testedOn),
        result: e.result,
        method: e.method,
        notes: e.notes,
        testedById: by,
        createdAt: e.at,
      });
      for (const evidenceId of new Set(evidence))
        b.rows.controlTestEvidence.push({ controlTestId: id, evidenceId });
      b.audit(e.at, by, "control.tested", "ControlTest", id, {
        controlCode: e.control,
        testedOn: e.testedOn,
        result: e.result,
        evidenceCount: new Set(evidence).size,
        method: lengthOf(e.method),
        notes: lengthOf(e.notes),
      });
      return;
    }
    case "soa": {
      const requirementId = b.requirement(e.framework, e.ref);
      const existing = b.rows.requirementApplicability.find(
        (a) => a.requirementId === requirementId,
      );
      const decision = {
        applicable: e.applicable,
        justification: e.justification,
        decidedById: by,
        decidedAt: e.at,
      };
      const snap = (d: { applicable: boolean; justification: string }) => ({
        applicable: d.applicable,
        justification: lengthOf(d.justification),
      });
      const before = existing ? snap(existing) : undefined;
      if (existing) Object.assign(existing, decision);
      else b.rows.requirementApplicability.push({ requirementId, ...decision });
      b.audit(
        e.at,
        by,
        "soa.applicability_set",
        "requirement",
        requirementId,
        snap(decision),
        before,
      );
      return;
    }
    case "narrative": {
      const id = b.id(e.at);
      b.rows.boardNarratives.push({
        id,
        periodKey: e.periodKey,
        periodStart: dateOnly(e.periodStart),
        periodEnd: dateOnly(e.periodEnd),
        text: e.text,
        aiInteractionId: null,
        approvedById: by,
        approvedAt: e.at,
      });
      b.audit(e.at, by, "report.narrative_approved", "BoardNarrative", id, {
        periodKey: e.periodKey,
        aiAssisted: false,
        text: lengthOf(e.text),
      });
      return;
    }
  }
}

/** Rows per table, ready for createMany, with ids, createdAt and occurredAt set. */
export function rowsFor(plan: SamplePlan, ctx: RowsContext): SampleRows {
  const rows = emptyRows();
  const users = new Map<string, string>();
  const b = new Builder(rows, idMaker(SAMPLE_SEED), ctx.library, users);
  const setupAt = startOfDay(ctx.now.getTime()) - SETUP_DAYS_AGO * DAY + 9 * 60 * MINUTE;
  writePeople(b, plan.people, new Date(setupAt));
  const scaleId = writeSetup(b, plan.people, setupAt);
  const extras = new Builder(rows, idMaker(SAMPLE_SEED + EXTRAS_SEED_OFFSET), ctx.library, users);
  writeIdentities(
    extras,
    plan.people,
    ctx.loader,
    ctx.bootstrapEmail,
    new Date(setupAt + 59 * MINUTE),
  );

  const book: RiskBook = new Map();
  const keys = new Map<string, string>();
  const state = {
    reference: 0,
    scaleId,
    reviewMonths: SAMPLE_ORGANISATION.reviewIntervalMonths,
    keys,
    assets: new Map<string, string>(),
  };
  plan.events.forEach((e, n) => {
    if (e.at.getTime() >= ctx.now.getTime()) throw new Error(`event ${e.kind} is not in the past`);
    b.requestId = `sample:${String(n).padStart(5, "0")}`;
    runReviewDue(b, book, e.at.getTime());
    if ("risk" in e) applyRiskEvent(b, book, state, e);
    else applyOther(b, e, keys);
  });
  runReviewDue(b, book, ctx.now.getTime());
  rows.risks.push(...[...book.values()].map((r) => r.row));
  const aiAct = new Builder(rows, idMaker(SAMPLE_SEED + AI_ACT_SEED_OFFSET), ctx.library, users);
  writeAiAct(aiAct, startOfDay(ctx.now.getTime()));
  return rows;
}
