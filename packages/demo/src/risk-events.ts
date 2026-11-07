import { createHash } from "node:crypto";
import { reviewDueDate } from "@isms/domain";
import { type Builder, type Json, lengthOf } from "./builder.js";
import {
  type ReplayState,
  type RiskBook,
  type RiskEvent,
  completeReviews,
  decide,
  edit,
  report,
  task,
  writeVersion,
} from "./risk-writes.js";
import { dateOnly } from "./time.js";

export type { ReplayState, RiskBook, RiskEntry } from "./risk-writes.js";
export { openReviewTasks, ruleOf } from "./risk-writes.js";

/** One risk event, written as the API's service for it writes it. */
export function applyRiskEvent(b: Builder, book: RiskBook, s: ReplayState, e: RiskEvent): void {
  const actor = b.user(e.by);
  if (e.kind === "report") {
    report(b, book, s, e, actor);
    return;
  }
  const r = book.get(e.risk);
  if (!r) throw new Error(`event ${e.kind} before ${e.risk} was reported`);
  const row = r.row;
  const at = e.at;
  const lifecycle = (
    action: string,
    extra: Record<string, Json>,
    was: { state: string; version: number },
  ) => {
    b.audit(
      at,
      actor,
      action,
      "Risk",
      row.id,
      { state: row.state, version: row.version, ...extra },
      was,
    );
  };
  switch (e.kind) {
    case "edit": {
      edit(b, r, s, at, actor, e.changes);
      return;
    }
    case "accept": {
      edit(b, r, s, at, actor, { treatment: "accept", treatmentNote: e.note });
      return;
    }
    case "submit": {
      const was = { state: row.state, version: row.version, reviewerId: row.reviewerId };
      Object.assign(row, {
        state: "in_review",
        reviewerId: actor,
        submittedAt: at,
        version: row.version + 1,
        updatedAt: at,
      });
      writeVersion(b, r, at, was.reviewerId === actor ? ["state"] : ["state", "reviewerId"], actor);
      b.audit(
        at,
        actor,
        "risk.submitted",
        "Risk",
        row.id,
        { state: row.state, version: row.version, reviewerId: actor },
        was,
      );
      return;
    }
    case "approve": {
      decide(b, r, s, at, actor, "approve", e.comment);
      return;
    }
    case "return": {
      decide(b, r, s, at, actor, "return", e.concern);
      return;
    }
    case "close": {
      const was = { state: row.state, version: row.version };
      Object.assign(row, {
        state: "closed",
        closedAt: at,
        closedById: actor,
        version: row.version + 1,
        updatedAt: at,
        nextReviewDue: dateOnly(reviewDueDate(at, s.reviewMonths)),
      });
      writeVersion(b, r, at, ["state", "closedAt", "closedById", "nextReviewDue"], actor, e.note);
      completeReviews(b, row.id, at, actor, e.note);
      lifecycle("risk.closed", { note: lengthOf(e.note) }, was);
      return;
    }
    case "reassess": {
      const was = { state: row.state, version: row.version };
      Object.assign(row, {
        state: "proposed",
        nextReviewDue: null,
        closedAt: null,
        closedById: null,
        reviewerId: null,
        submittedAt: null,
        version: row.version + 1,
        updatedAt: at,
      });
      writeVersion(
        b,
        r,
        at,
        ["state", "nextReviewDue", "closedAt", "closedById", "reviewerId", "submittedAt"],
        actor,
        e.reason,
      );
      lifecycle("risk.reassessed", { reason: lengthOf(e.reason) }, was);
      return;
    }
    case "review": {
      const was = { state: row.state, version: row.version };
      Object.assign(row, {
        nextReviewDue: dateOnly(reviewDueDate(at, s.reviewMonths)),
        version: row.version + 1,
        updatedAt: at,
      });
      completeReviews(b, row.id, at, actor, e.note);
      writeVersion(b, r, at, ["nextReviewDue"], actor, e.note);
      lifecycle("risk.review_confirmed", { note: lengthOf(e.note) }, was);
      return;
    }
    case "control_accept": {
      const controlId = b.control(e.control);
      const id = b.id(at);
      b.rows.riskControls.push({
        id,
        riskId: row.id,
        controlId,
        status: "accepted",
        reason: e.reason,
        source: "person",
        suggestedById: null,
        aiInteractionId: null,
        decidedById: actor,
        decidedAt: at,
        createdAt: at,
      });
      r.controls.set(e.control, controlId);
      const old = row.version;
      Object.assign(row, { version: old + 1, updatedAt: at });
      writeVersion(b, r, at, ["controls"], actor);
      const reason = e.reason === "" ? {} : { reason: { changed: true, length: e.reason.length } };
      b.audit(
        at,
        actor,
        "risk.control_added",
        "Risk",
        row.id,
        { version: row.version, controlCode: e.control, ...reason },
        { version: old },
      );
      return;
    }
    case "action_open":
    case "evidence_request": {
      const kind = e.kind === "action_open" ? "treatment_action" : "evidence_request";
      const id = b.id(at);
      const controlCode = e.control;
      b.rows.tasks.push({
        id,
        kind,
        title: e.title,
        description: e.description,
        assigneeId: b.user(e.assignee),
        requestedById: actor,
        dueDate: e.due === null ? null : dateOnly(e.due),
        status: "open",
        riskId: row.id,
        controlId: controlCode === null ? null : b.control(controlCode),
        completedAt: null,
        completionNote: "",
        completedById: null,
        cancelledReason: "",
        cancelledById: null,
        createdAt: at,
        updatedAt: at,
      });
      s.keys.set(e.kind === "action_open" ? e.action : e.request, id);
      b.audit(at, actor, "task.created", "Task", id, {
        kind,
        riskId: row.id,
        controlCode,
        assigneeId: b.user(e.assignee),
        dueDate: e.due,
        title: lengthOf(e.title),
        description: lengthOf(e.description),
      });
      return;
    }
    case "action_done": {
      const t = task(b, s.keys.get(e.action) ?? "");
      Object.assign(t, {
        status: "done",
        completedAt: at,
        completedById: actor,
        completionNote: e.note,
        updatedAt: at,
      });
      b.audit(
        at,
        actor,
        "task.completed",
        "Task",
        t.id,
        {
          status: "done",
          kind: "treatment_action",
          riskId: row.id,
          note: lengthOf(e.note),
        },
        { status: "open" },
      );
      return;
    }
    case "evidence": {
      const id = b.id(at);
      const body = new TextEncoder().encode(e.body);
      const sha256 = createHash("sha256").update(body).digest("hex");
      const objectKey = `evidence/${id}`;
      const request = e.request === null ? null : task(b, s.keys.get(e.request) ?? "");
      const codes = [...e.controls].sort();
      b.rows.evidence.push({
        id,
        riskId: row.id,
        ...(request ? { taskId: request.id } : {}),
        objectKey,
        fileName: e.fileName,
        sha256,
        sizeBytes: body.length,
        mimeType: e.mimeType,
        classification: e.classification,
        uploadedById: actor,
        collectedAt: at,
        createdAt: at,
      });
      for (const code of codes)
        b.rows.evidenceControls.push({ evidenceId: id, controlId: b.control(code) });
      b.rows.evidenceObjects.push({ key: objectKey, body, contentType: e.mimeType });
      r.evidence.push({ id, sha256 });
      s.keys.set(e.evidence, id);
      b.audit(at, actor, "evidence.added", "Evidence", id, {
        fileName: e.fileName,
        sha256,
        size: body.length,
        mime: e.mimeType,
        controls: codes,
      });
      if (request) {
        Object.assign(request, { status: "done", completedAt: at, updatedAt: at });
        b.audit(
          at,
          actor,
          "task.completed",
          "Task",
          request.id,
          { status: "done", evidenceId: id },
          { status: "open" },
        );
      }
      return;
    }
  }
}
