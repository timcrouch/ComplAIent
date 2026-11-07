import { reviewDueDate } from "@isms/domain";
import type { RiskTemplate } from "./catalogue.js";
import type { Dice } from "./random.js";
import { DAY, type Timeline, isoDay } from "./time.js";
import type { RiskChanges, SampleEvent } from "./types.js";
import { SAMPLE_APPETITE_THRESHOLD } from "./company.js";
import * as T from "./texts.js";

/** How a risk's year goes; the story may stop early when it runs into today. */
export type Path =
  | "draft"
  | "draft_unscored"
  | "in_review"
  | "returned"
  | "return_approve"
  | "approved"
  | "accepted"
  | "closed"
  | "closed_reassessed"
  | "approved_reassessed"
  | "reviewed";

export type RiskSeed = {
  key: string;
  template: RiskTemplate;
  title: string;
  reportedAt: number;
  path: Path;
  high: boolean;
  owner: string;
  reviewer: string;
  reporter: string;
  site: string | null;
  department: string;
  /** Days from approval (or the last action) to closing. */
  closeAfter: [number, number];
  /** Chance that a treatment action not needed for closing is done. */
  doneChance: number;
  assignees: readonly string[];
  /** Approve (or close) on this day when the story gets there earlier. */
  approveOn?: number;
  closeOn?: number;
  /** Confirm the yearly review once due (the oldest risk), so a done review always shows. */
  confirmReview?: true;
};

const CLOSING: ReadonlySet<Path> = new Set(["closed", "closed_reassessed"]);

/** The first assessment: the template's, nudged now and then within its band. */
function score(s: RiskSeed, d: Dice): { l: number; i: number } {
  let l = s.template.likelihood;
  const i = s.template.impact;
  if (d.chance(0.3)) {
    if (s.high) l = Math.min(5, l + 1);
    else l = Math.max(1, l - 1);
  }
  if (!s.high && l * i > SAMPLE_APPETITE_THRESHOLD) l = Math.floor(SAMPLE_APPETITE_THRESHOLD / i);
  if (s.high && l * i <= SAMPLE_APPETITE_THRESHOLD) l = Math.min(5, Math.ceil(10 / i));
  return { l, i };
}

const expected = (l: number, i: number, d: Dice) => ({
  residualLikelihood: Math.max(1, l - d.int(1, 2)),
  residualImpact: Math.max(1, i - d.int(0, 1)),
});

/** Every event of one risk, in order; branches (actions, evidence) may interleave by time. */
export function riskStory(s: RiskSeed, d: Dice, tl: Timeline): SampleEvent[] {
  const out: SampleEvent[] = [];
  const risk = s.key;
  let t = s.reportedAt;
  const step = (min: number, max: number, make: (at: Date) => SampleEvent): boolean => {
    const next = tl.later(t, min, max);
    if (next === null) return false;
    t = next;
    out.push(make(new Date(next)));
    return true;
  };
  /** `step`, but on the day of `target` when that is later. */
  const stepOn = (
    target: number | undefined,
    min: number,
    max: number,
    make: (at: Date) => SampleEvent,
  ) => {
    if (target !== undefined && target - DAY > t) {
      t = target - DAY;
      return step(1, 1, make);
    }
    return step(min, max, make);
  };
  const toConfirm = d.chance(0.3) ? [d.pick(T.QUESTIONS)] : [];
  out.push({
    at: new Date(t),
    kind: "report",
    risk,
    by: s.reporter,
    title: s.title,
    scenario: s.template.scenario,
    threat: s.template.threat,
    consequence: s.template.consequence,
    existingSafeguards: d.chance(0.5) ? d.pick(T.SAFEGUARDS) : "",
    toConfirm,
    site: s.site,
    department: s.department,
    assets: s.template.assets,
  });
  if (s.path === "draft_unscored") {
    if (d.chance(0.5))
      step(1, 10, (at) => ({
        at,
        kind: "edit",
        risk,
        by: s.reviewer,
        changes: { owner: s.owner },
      }));
    return out;
  }

  const { l, i } = score(s, d);
  const withExpected = s.path !== "draft" || d.chance(0.4);
  const first: RiskChanges = {
    likelihood: l,
    impact: i,
    treatment: d.weighted([
      ["mitigate", 80],
      ["transfer", 12],
      ["avoid", 8],
    ] as const),
    treatmentNote: d.pick(T.TREATMENT_NOTES),
    owner: s.owner,
    ...(withExpected ? expected(l, i, d) : {}),
    ...(toConfirm.length > 0 && (s.path !== "draft" || d.chance(0.5)) ? { toConfirm: [] } : {}),
  };
  if (!step(0, 6, (at) => ({ at, kind: "edit", risk, by: s.reviewer, changes: first }))) return out;
  const controls = s.template.controls.slice(0, d.int(1, Math.min(3, s.template.controls.length)));
  for (const control of controls) {
    const ok = step(0, 2, (at) => ({
      at,
      kind: "control_accept",
      risk,
      by: s.reviewer,
      control,
      reason: d.pick(T.CONTROL_REASONS),
    }));
    if (!ok) return out;
  }
  if (s.path === "draft") return out;
  const accepted = s.path === "accepted";
  if (
    accepted &&
    !step(0, 5, (at) => ({
      at,
      kind: "accept",
      risk,
      by: s.reviewer,
      note: d.pick(T.ACCEPT_NOTES),
    }))
  )
    return out;
  if (!step(0, 4, (at) => ({ at, kind: "submit", risk, by: s.reviewer }))) return out;
  if (s.path === "in_review") return out;
  const independent = s.high || accepted;
  const approver =
    !independent && s.reviewer !== s.reporter && d.chance(0.4)
      ? s.reviewer
      : s.site === "frankfurt" && d.chance(0.35)
        ? "ben"
        : "adam";
  const decider = approver === s.reviewer ? "adam" : approver;
  if (s.path === "returned" || s.path === "return_approve") {
    if (
      !step(1, 6, (at) => ({ at, kind: "return", risk, by: decider, concern: d.pick(T.CONCERNS) }))
    )
      return out;
    if (s.path === "returned") return out;
    const fix: RiskChanges = { treatmentNote: d.pick(T.TREATMENT_NOTES), ...expected(l, i, d) };
    if (!step(1, 8, (at) => ({ at, kind: "edit", risk, by: s.reviewer, changes: fix }))) return out;
    if (!step(0, 3, (at) => ({ at, kind: "submit", risk, by: s.reviewer }))) return out;
  }
  if (
    !stepOn(s.approveOn, 1, 8, (at) => ({
      at,
      kind: "approve",
      risk,
      by: approver,
      comment: d.chance(0.4) ? d.pick(T.APPROVE_COMMENTS) : "",
    }))
  )
    return out;
  const approvedAt = t;

  // Treatment actions: all done before closing; otherwise done by chance, open or overdue.
  const closing = CLOSING.has(s.path) || (s.path === "reviewed" && s.high);
  let lastDone = approvedAt;
  let allDone = true;
  if (!accepted) {
    const count = d.int(1, 3);
    for (let n = 1; n <= count; n += 1) {
      const openAt = tl.later(approvedAt, 0, 6);
      if (openAt === null) break;
      const action = `${risk}-a${String(n)}`;
      const dueDays = d.int(14, 60);
      const due = isoDay(openAt + dueDays * DAY);
      const control = d.chance(0.5) ? d.pick(controls) : null;
      const [title, description] = d.pick(T.ACTIONS);
      const assignee = d.chance(0.6) ? s.owner : d.pick(s.assignees);
      out.push({
        at: new Date(openAt),
        kind: "action_open",
        risk,
        by: s.reviewer,
        action,
        title,
        description,
        assignee,
        due,
        control,
      });
      const doneAt =
        closing || d.chance(s.doneChance)
          ? tl.later(openAt, 3, dueDays + (closing ? 0 : 10))
          : null;
      if (doneAt === null) {
        allDone = false;
        continue;
      }
      out.push({
        at: new Date(doneAt),
        kind: "action_done",
        risk,
        by: assignee,
        action,
        due,
        note: d.pick(T.DONE_NOTES),
      });
      lastDone = Math.max(lastDone, doneAt);
    }
  }

  // Evidence on the accepted controls: uploaded by the reviewer, or requested from someone.
  controls.forEach((control, n) => {
    if (!d.chance(0.65)) return;
    const evidence = `${risk}-e${String(n + 1)}`;
    const file = d.pick(T.EVIDENCE_FILES);
    const upload = (at: number, by: string, request: string | null): SampleEvent => ({
      at: new Date(at),
      kind: "evidence",
      risk,
      by,
      evidence,
      request,
      controls: [control],
      fileName: file.name,
      mimeType: file.mime,
      classification: d.weighted([
        ["internal", 6],
        ["confidential", 3],
        ["restricted", 1],
      ] as const),
      body: T.evidenceBody(file.name, control, s.title, isoDay(at)),
    });
    if (d.chance(0.55)) {
      const at = tl.later(approvedAt, 1, 30);
      if (at !== null) out.push(upload(at, s.reviewer, null));
      return;
    }
    const askAt = tl.later(approvedAt, 1, 12);
    if (askAt === null) return;
    const request = `${risk}-q${String(n + 1)}`;
    const assignee = d.pick(s.assignees);
    const due = d.chance(0.8) ? isoDay(askAt + d.int(14, 30) * DAY) : null;
    out.push({
      at: new Date(askAt),
      kind: "evidence_request",
      risk,
      by: s.reviewer,
      request,
      control,
      assignee,
      title: `Evidence for ${control}`,
      description: d.pick(T.REQUEST_TEXTS),
      due,
    });
    const doneAt = d.chance(0.75) ? tl.later(askAt, 1, 20) : null;
    if (doneAt !== null) out.push(upload(doneAt, assignee, request));
  });

  t = lastDone;
  let settledAt = approvedAt;
  let closed = false;
  if (closing && allDone) {
    const [min, max] = s.path === "reviewed" ? [3, 12] : s.closeAfter;
    if (
      !stepOn(s.closeOn, min, max, (at) => ({
        at,
        kind: "close",
        risk,
        by: s.reviewer,
        note: d.pick(T.CLOSE_NOTES),
      }))
    )
      return out;
    settledAt = t;
    closed = true;
  }
  if (s.path === "closed_reassessed" || s.path === "approved_reassessed") {
    if (s.path === "closed_reassessed" && !closed) return out;
    if (s.path === "approved_reassessed") t = approvedAt + d.int(60, 150) * DAY;
    const wait: [number, number] = s.path === "closed_reassessed" ? [20, 80] : [0, 0];
    if (
      !step(wait[0], wait[1], (at) => ({
        at,
        kind: "reassess",
        risk,
        by: s.reviewer,
        reason: d.pick(T.REASSESS_REASONS),
      }))
    )
      return out;
    const lower = Math.max(1, Math.min(l - 1, Math.floor(SAMPLE_APPETITE_THRESHOLD / i)));
    const changes: RiskChanges = {
      likelihood: lower,
      residualLikelihood: Math.max(1, lower - 1),
      residualImpact: Math.max(1, i - 1),
    };
    if (!step(1, 10, (at) => ({ at, kind: "edit", risk, by: s.reviewer, changes }))) return out;
    if (d.chance(0.5) && step(0, 4, (at) => ({ at, kind: "submit", risk, by: s.reviewer })))
      step(1, 8, (at) => ({ at, kind: "approve", risk, by: "adam", comment: "" }));
    return out;
  }
  if (s.path === "reviewed") {
    // The review falls due a year after approval or closing; some are confirmed, some overdue.
    const due = Date.parse(`${reviewDueDate(new Date(settledAt), 12)}T00:00:00Z`);
    if (due < tl.today0 && (d.chance(0.6) || s.confirmReview === true)) {
      t = Math.max(due, t);
      const [min, max] = s.confirmReview ? [1, 1] : [1, 8];
      step(min, max, (at) => ({
        at,
        kind: "review",
        risk,
        by: s.reviewer,
        note: d.pick(T.REVIEW_NOTES),
      }));
    }
  }
  return out;
}
