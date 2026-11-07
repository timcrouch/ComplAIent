import { createHash } from "node:crypto";
import { RISK_STATES, boardPeriods, isoDateUtc } from "@isms/domain";
import { describe, expect, it } from "vitest";
import {
  SAMPLE_APPETITE_THRESHOLD,
  type SampleRows,
  planSampleYear,
  rowsFor,
} from "../src/index.js";
import { NOWS, countsAt, fakeLibrary } from "./helpers.js";

const DAY = 86_400_000;
const library = fakeLibrary();
const build = (now: Date, extra: Partial<Parameters<typeof rowsFor>[1]> = {}): SampleRows =>
  rowsFor(planSampleYear(now), { now, library, loader: null, bootstrapEmail: null, ...extra });

describe.each(NOWS)("rowsFor at %s", (iso) => {
  const now = new Date(iso);
  const today = isoDateUtc(now);
  const rows = build(now);
  const userId = (email: string) => rows.users.find((u) => u.email === email)?.id ?? "";

  it("is deterministic", () => {
    expect(build(now)).toEqual(rows);
  });

  it("gives every risk version a sequence 1..n, n being the risk's version", () => {
    const byRisk = new Map<string, number[]>();
    for (const v of rows.riskVersions)
      byRisk.set(v.riskId, [...(byRisk.get(v.riskId) ?? []), v.version]);
    for (const risk of rows.risks) {
      const versions = byRisk.get(risk.id) ?? [];
      expect(versions).toEqual(Array.from({ length: risk.version }, (_, i) => i + 1));
    }
  });

  it("gives every audit row an actor that exists", () => {
    const ids = new Set(rows.users.map((u) => u.id));
    for (const a of rows.auditEvents) expect(ids.has(a.actorUserId ?? ""), a.action).toBe(true);
  });

  it("stamps every row in the past", () => {
    const stamps = [
      ...rows.auditEvents.map((a) => a.occurredAt),
      ...rows.riskVersions.map((v) => v.createdAt),
      ...rows.risks.map((r) => r.updatedAt),
      ...rows.tasks.map((t) => t.createdAt),
    ];
    for (const s of stamps) expect(s.getTime()).toBeLessThanOrEqual(now.getTime());
  });

  it("uses unique ids", () => {
    const ids = [
      rows.users,
      rows.risks,
      rows.riskVersions,
      rows.auditEvents,
      rows.tasks,
      rows.evidence,
    ]
      .flat()
      .map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("ends with every risk state, task kind and control test result", () => {
    expect(new Set(rows.risks.map((r) => r.state))).toEqual(new Set(RISK_STATES));
    expect(new Set(rows.tasks.map((t) => t.kind))).toEqual(
      new Set(["evidence_request", "treatment_action", "periodic_review"]),
    );
    expect(new Set(rows.controlTests.map((t) => t.result))).toEqual(
      new Set(["effective", "partially_effective", "ineffective"]),
    );
  });

  it("has expected scores on most approved or closed risks, and some proposed risks unscored", () => {
    const settled = rows.risks.filter((r) => r.state === "approved" || r.state === "closed");
    const withExpected = settled.filter((r) => r.residualLikelihood !== null);
    expect(withExpected.length / settled.length).toBeGreaterThan(0.6);
    expect(rows.risks.some((r) => r.state === "proposed" && r.likelihood === null)).toBe(true);
    expect(rows.risks.some((r) => r.treatment === "accept" && r.state === "approved")).toBe(true);
  });

  it("brings the above-appetite count down over the year", () => {
    const start = now.getTime() - 365 * DAY;
    const month = (m: number) => new Date(start + m * 30.4 * DAY);
    const early = countsAt(rows, month(2), SAMPLE_APPETITE_THRESHOLD).above;
    const late = countsAt(rows, month(11), SAMPLE_APPETITE_THRESHOLD).above;
    expect(early).toBeGreaterThan(late);
    // Still visible on the map today.
    expect(countsAt(rows, now, SAMPLE_APPETITE_THRESHOLD).above).toBeGreaterThan(0);
  });

  it("scopes Olga to Munich, where she sees fewer risks than the organisation", () => {
    const olga = userId("owner@example.test");
    const munich = rows.sites.find((s) => s.name === "Munich")?.id;
    expect(rows.roleAssignments.filter((a) => a.userId === olga)).toEqual([
      expect.objectContaining({ role: "risk_owner", scopeType: "SITE", siteId: munich }),
    ]);
    const seen = rows.risks.filter(
      (r) => r.siteId === munich || r.ownerId === olga || r.reporterId === olga,
    );
    expect(seen.every((r) => r.siteId === munich)).toBe(true);
    expect(seen.length).toBeGreaterThan(10);
    expect(seen.length).toBeLessThan(rows.risks.length);
    expect(rows.risks.some((r) => r.ownerId === olga)).toBe(true);
  });

  it("has an owner with a backlog and one who treats steadily", () => {
    const fictional = rows.users.filter((u) => u.idpIssuer === "pending:");
    const overdue = rows.tasks.filter(
      (t) =>
        t.kind === "treatment_action" &&
        t.status === "open" &&
        t.dueDate !== null &&
        isoDateUtc(t.dueDate) < today,
    );
    const backlog = fictional.filter((u) => {
      const open = rows.risks.filter((r) => r.ownerId === u.id && r.state !== "closed");
      const late = overdue.filter((t) => open.some((r) => r.id === t.riskId));
      return open.length >= 8 && late.length >= 3;
    });
    expect(backlog.length).toBeGreaterThanOrEqual(1);
    const steady = fictional.filter((u) => {
      const months = new Set(
        rows.risks
          .filter((r) => r.ownerId === u.id && r.closedAt !== null)
          .map((r) => r.closedAt?.toISOString().slice(0, 7)),
      );
      return months.size >= 4;
    });
    expect(steady.length).toBeGreaterThanOrEqual(1);
  });

  it("makes last month's board pack non-empty", () => {
    const last = boardPeriods(now)[1];
    if (!last) throw new Error("no last month");
    const from = Date.parse(`${last.start}T00:00:00Z`);
    const until = Date.parse(`${last.end}T00:00:00Z`) + DAY;
    const within = (d: Date) => d.getTime() >= from && d.getTime() < until;
    expect(rows.risks.filter((r) => within(r.createdAt)).length).toBeGreaterThan(0);
    expect(
      rows.approvals.filter((a) => a.decision === "approved" && within(a.createdAt)).length,
    ).toBeGreaterThan(0);
    const closedIn = rows.riskVersions.filter(
      (v) =>
        v.changedFields.includes("state") &&
        (v.snapshot as { state: string }).state === "closed" &&
        within(v.createdAt),
    );
    expect(closedIn.length).toBeGreaterThan(0);
    expect(rows.boardNarratives.some((n) => n.periodKey === last.key)).toBe(true);
  });

  it("has reviews done, due and overdue", () => {
    const reviews = rows.tasks.filter((t) => t.kind === "periodic_review");
    expect(reviews.some((t) => t.status === "done")).toBe(true);
    expect(
      reviews.some(
        (t) => t.status === "open" && t.dueDate !== null && isoDateUtc(t.dueDate) < today,
      ),
    ).toBe(true);
    const due = rows.risks.filter(
      (r) =>
        (r.state === "approved" || r.state === "closed") &&
        r.nextReviewDue !== null &&
        isoDateUtc(r.nextReviewDue) <= today,
    );
    expect(due.length).toBeGreaterThan(0);
    for (const r of due)
      expect(
        reviews.some((t) => t.riskId === r.id && t.status === "open"),
        r.title,
      ).toBe(true);
  });

  it("links evidence to accepted controls and stores a body matching each hash", () => {
    expect(rows.evidence.length).toBeGreaterThan(10);
    for (const e of rows.evidence) {
      const object = rows.evidenceObjects.find((o) => o.key === e.objectKey);
      expect(object).toBeDefined();
      expect(
        createHash("sha256")
          .update(object?.body ?? new Uint8Array())
          .digest("hex"),
      ).toBe(e.sha256);
      expect(object?.body.length).toBe(e.sizeBytes);
      const links = rows.evidenceControls.filter((l) => l.evidenceId === e.id);
      expect(links.length).toBeGreaterThan(0);
      for (const l of links)
        expect(
          rows.riskControls.some(
            (rc) =>
              rc.riskId === e.riskId && rc.controlId === l.controlId && rc.status === "accepted",
          ),
        ).toBe(true);
    }
    expect(rows.controlTestEvidence.length).toBeGreaterThan(0);
  });

  it("decides some SoA requirements as not applicable", () => {
    expect(rows.requirementApplicability.some((a) => !a.applicable)).toBe(true);
  });

  it("writes the API's audit actions", () => {
    const actions = new Set(rows.auditEvents.map((a) => a.action));
    for (const action of [
      "identity.bootstrap_admin",
      "identity.role_granted",
      "organisation.profile_updated",
      "organisation.site_added",
      "organisation.department_added",
      "organisation.framework_confirmed",
      "organisation.risk_scale_created",
      "organisation.setup_completed",
      "risk.reported",
      "risk.updated",
      "risk.control_added",
      "risk.submitted",
      "risk.returned",
      "risk.approved",
      "risk.closed",
      "risk.reassessed",
      "risk.review_confirmed",
      "task.created",
      "task.completed",
      "evidence.added",
      "control.tested",
      "soa.applicability_set",
      "report.narrative_approved",
    ])
      expect(actions.has(action), action).toBe(true);
    const approved = rows.auditEvents.find((a) => a.action === "risk.approved");
    expect(Object.keys(approved?.afterRef as object).sort()).toEqual(
      ["approvalId", "comment", "decidedVersion", "rule", "state", "version"].sort(),
    );
  });
});

describe("rowsFor identities (P9-R3)", () => {
  const now = new Date(NOWS[0]);
  const admins = (rows: SampleRows) =>
    rows.roleAssignments
      .filter((a) => a.role === "administrator" && a.scopeType === "ORGANISATION")
      .map((a) => rows.users.find((u) => u.id === a.userId)?.email);

  it("writes everyone as a pending placeholder without a loader", () => {
    const rows = build(now);
    for (const u of rows.users) {
      expect(u.idpIssuer).toBe("pending:");
      expect(u.idpSubject).toBe(u.email);
    }
    expect(admins(rows)).toEqual(["admin@example.test"]);
  });

  it("gives a loader who is a sample person their real identity", () => {
    const loader = {
      email: "Admin@Example.test",
      idpIssuer: "https://idp/realms/isms",
      idpSubject: "sub-1",
    };
    const rows = build(now, { loader });
    const anna = rows.users.filter((u) => u.email.toLowerCase() === "admin@example.test");
    expect(anna).toEqual([
      expect.objectContaining({ idpIssuer: loader.idpIssuer, idpSubject: "sub-1" }),
    ]);
    expect(rows.users.filter((u) => u.idpIssuer !== "pending:")).toHaveLength(1);
  });

  it("adds a real loader outside the sample with their exact identity and administrator", () => {
    const loader = {
      email: "loader@corp.example",
      idpIssuer: "https://idp/realms/isms",
      idpSubject: "sub-loader",
    };
    const rows = build(now, { loader, bootstrapEmail: "boss@corp.example" });
    const loaderRow = rows.users.find((u) => u.email === "loader@corp.example");
    expect(loaderRow).toEqual(
      expect.objectContaining({ idpIssuer: loader.idpIssuer, idpSubject: "sub-loader" }),
    );
    const boss = rows.users.find((u) => u.email === "boss@corp.example");
    expect(boss).toEqual(
      expect.objectContaining({ idpIssuer: "pending:", idpSubject: "boss@corp.example" }),
    );
    expect(admins(rows).sort()).toEqual(
      ["admin@example.test", "boss@corp.example", "loader@corp.example"].sort(),
    );
  });

  it("writes one row when the bootstrap email is the loader's", () => {
    const loader = { email: "loader@corp.example", idpIssuer: "iss", idpSubject: "sub" };
    const rows = build(now, { loader, bootstrapEmail: " LOADER@corp.example " });
    expect(rows.users.filter((u) => u.email.toLowerCase() === "loader@corp.example")).toHaveLength(
      1,
    );
  });

  it("makes a sample person named as the bootstrap email an administrator", () => {
    const rows = build(now, { bootstrapEmail: "ciso@example.test" });
    expect(admins(rows).sort()).toEqual(["admin@example.test", "ciso@example.test"]);
    expect(rows.users).toHaveLength(build(now).users.length);
  });

  it("changes nothing else with the loader", () => {
    const plain = build(now);
    const loaded = build(now, {
      loader: { email: "loader@corp.example", idpIssuer: "iss", idpSubject: "sub" },
    });
    expect(loaded.risks).toEqual(plain.risks);
    expect(loaded.riskVersions).toEqual(plain.riskVersions);
  });
});
