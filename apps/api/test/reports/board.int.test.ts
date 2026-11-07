import type { BoardPackResponse } from "@isms/contracts";
import {
  type BoardPeriod,
  type Clock,
  boardPeriodByKey,
  boardPeriods,
  defaultBoardPeriod,
  formatRiskReference,
} from "@isms/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "../../src/identity/index.js";
import { BoardService } from "../../src/reports/index.js";
import { db } from "../risks/harness.js";
import { reportsHarness } from "./harness.js";

const DAY_MS = 86_400_000;
const at = (isoDay: string, offsetDays = 0) =>
  new Date(new Date(`${isoDay}T12:00:00Z`).getTime() + offsetDays * DAY_MS);
const today = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);

describe("board pack", () => {
  const h = reportsHarness();
  beforeAll(() => h.start());
  beforeEach(async () => {
    await h.reset();
    await h.grant("carl", "auditor", "siteA");
  });
  afterAll(() => h.stop());

  const board = async (who: Parameters<typeof h.get>[1], query = "") => {
    const res = await h.get(`/api/v1/reports/board${query}`, who);
    return { status: res.status, body: res.body as BoardPackResponse };
  };

  const cisoActor = (): Actor => ({
    userId: h.userIds.cora,
    email: "cora@example.test",
    authTime: 0,
    authTimeSource: "auth_time",
    roles: [{ role: "ciso", scope: { type: "organisation", id: null } }],
  });

  const period = defaultBoardPeriod(new Date());
  const inPeriod = at(period.start, 10);
  const before = at(period.start, -5);

  const approve = (riskId: string, createdAt: Date, version = 1) =>
    db.approval.create({
      data: {
        riskId,
        version,
        decision: "approved",
        approverId: h.userIds.april,
        snapshot: {},
        createdAt,
      },
    });
  const closeVersion = (riskId: string, createdAt: Date) =>
    db.riskVersion.create({
      data: {
        riskId,
        version: 2,
        snapshot: { state: "closed" },
        changedFields: ["state"],
        changedById: h.userIds.cora,
        createdAt,
      },
    });
  const action = (riskId: string, status: "open" | "done" | "cancelled", dueDate: Date | null) =>
    db.task.create({
      data: {
        kind: "treatment_action",
        title: "Act",
        assigneeId: h.userIds.oscar,
        requestedById: h.userIds.cora,
        riskId,
        status,
        dueDate,
      },
    });

  async function seed() {
    const r1 = await h.seedRisk(
      {
        title: "Top",
        likelihood: 5,
        impact: 5,
        residualLikelihood: 2,
        residualImpact: 3,
        treatment: "mitigate",
        state: "approved",
        ownerId: h.userIds.oscar,
        createdAt: inPeriod,
      },
      "siteA",
    );
    await approve(r1.id, inPeriod);
    await action(r1.id, "done", null);
    await action(r1.id, "open", new Date(today().getTime() - 2 * DAY_MS));
    await action(r1.id, "cancelled", null);
    const r2 = await h.seedRisk(
      {
        title: "Second",
        likelihood: 4,
        impact: 4,
        treatment: "accept",
        state: "approved",
        createdAt: before,
        nextReviewDue: new Date(today().getTime() - DAY_MS),
      },
      "siteB",
    );
    await approve(r2.id, before);
    const r3 = await h.seedRisk({ title: "Third", likelihood: 4, impact: 4, createdAt: inPeriod });
    const r4 = await h.seedRisk({
      title: "Closed in period",
      likelihood: 5,
      impact: 5,
      state: "closed",
      createdAt: before,
    });
    await closeVersion(r4.id, inPeriod);
    const r5 = await h.seedRisk({
      title: "Closed before",
      likelihood: 5,
      impact: 5,
      state: "closed",
      createdAt: before,
    });
    await closeVersion(r5.id, before);
    await h.seedRisk({ title: "Low", likelihood: 1, impact: 1 });
    const more = [];
    for (const title of ["Seventh", "Eighth", "Ninth"])
      more.push(await h.seedRisk({ title, likelihood: 3, impact: 4 }));
    return { r1, r2, r3, more };
  }

  it("counts facts within the period and orders the top risks", async () => {
    const { r1, r2, r3, more } = await seed();
    const { status, body } = await board("cora");
    expect(status).toBe(200);
    expect(body.period).toEqual(period);
    expect(body.periods).toEqual(boardPeriods(new Date()));
    expect(body.facts).toEqual({
      openRisks: 7,
      aboveAppetite: 6,
      reported: 2,
      approved: 1,
      closed: 1,
      overdueActions: 1,
      reviewsDue: 1,
    });
    expect(body.topRisks.map((r) => r.reference)).toEqual(
      [r1, r2, r3, more[0], more[1]].map((r) => formatRiskReference(r?.reference ?? 0)),
    );
    expect(body.topRisks[0]).toEqual({
      reference: formatRiskReference(r1.reference),
      title: "Top",
      owner: "Oscar Owner",
      treatment: "mitigate",
      score: 25,
      residualScore: 6,
      actions: { done: 1, total: 2 },
    });
    // Accepted: expected stays inherent (P5-R2).
    expect(body.topRisks[1]).toMatchObject({
      residualScore: 16,
      owner: null,
      actions: { done: 0, total: 0 },
    });
    expect(body.mapNow).toMatchObject({ basis: "inherent", total: 7 });
    expect(body.mapExpected).toMatchObject({ basis: "residual", total: 7 });
    expect(body.movement).toHaveLength(12);
    expect(body).toMatchObject({
      generatedBy: "Cora Ciso",
      scope: { kind: "organisation" },
      narrative: null,
      canApproveNarrative: true,
    });
  });

  it("scopes the facts to a site auditor's units", async () => {
    await seed();
    const { status, body } = await board("carl");
    expect(status).toBe(200);
    expect(body.scope).toEqual({ kind: "units", names: ["Riga"] });
    expect(body.facts).toEqual({
      openRisks: 1,
      aboveAppetite: 1,
      reported: 1,
      approved: 1,
      closed: 0,
      overdueActions: 1,
      reviewsDue: 0,
    });
    expect(body.topRisks.map((r) => r.title)).toEqual(["Top"]);
    expect(body.canApproveNarrative).toBe(false);
    expect(body.canDraftNarrative).toBe(false);
  });

  it("shows the newest approved narrative for the period", async () => {
    const narrative = (p: BoardPeriod, text: string, approvedAt: Date) =>
      db.boardNarrative.create({
        data: {
          periodKey: p.key,
          periodStart: new Date(`${p.start}T00:00:00Z`),
          periodEnd: new Date(`${p.end}T00:00:00Z`),
          text,
          approvedById: h.userIds.april,
          approvedAt,
        },
      });
    const rolling = boardPeriodByKey(new Date(), "last-30-days") as BoardPeriod;
    await narrative(period, "Older", new Date(Date.now() - 2 * DAY_MS));
    await narrative(period, "Newer", new Date(Date.now() - DAY_MS));
    await narrative(rolling, "Other period", new Date());
    // P7-R12: the same key over other days (an older "last 30 days") is never shown.
    await narrative({ ...rolling, start: period.start, end: period.end }, "Stale", new Date());
    const { body } = await board("april");
    expect(body.narrative).toMatchObject({
      text: "Newer",
      approvedBy: "April Approver",
      aiAssisted: false,
    });
    expect(body.canApproveNarrative).toBe(true);
    const other = await board("april", "?period=last-30-days");
    expect(other.body.period.key).toBe("last-30-days");
    expect(other.body.narrative?.text).toBe("Other period");
    // P7-R8: a narrative is organisation-wide; a scoped reader gets none and may not write one.
    const scoped = await board("carl");
    expect(scoped.body).toMatchObject({
      narrative: null,
      canDraftNarrative: false,
      canApproveNarrative: false,
    });
  });

  it("counts a December period in January, its last millisecond in and the next day out", async () => {
    const service = h.service(BoardService);
    const clock = (service as unknown as { clock: Clock }).clock;
    Object.assign(service, { clock: { now: () => new Date("2027-01-15T10:00:00Z") } });
    try {
      const inside = await h.seedRisk({
        title: "Last moment",
        createdAt: new Date("2026-12-31T23:59:59.999Z"),
      });
      await approve(inside.id, new Date("2026-12-31T23:59:59.999Z"));
      const outside = await h.seedRisk({
        title: "Next day",
        createdAt: new Date("2027-01-01T00:00:00.000Z"),
      });
      await approve(outside.id, new Date("2027-01-01T00:00:00.000Z"));
      await h.seedRisk({ title: "First moment", createdAt: new Date("2026-12-01T00:00:00.000Z") });
      await h.seedRisk({ title: "Day before", createdAt: new Date("2026-11-30T23:59:59.999Z") });
      const pack = await service.get(cisoActor(), { period: "2026-12" });
      expect(pack.period).toEqual({ key: "2026-12", start: "2026-12-01", end: "2026-12-31" });
      expect(pack.periods.map((p) => p.key)).toContain("2026-12");
      expect(pack.facts).toMatchObject({ reported: 2, approved: 1 });
      const byDefault = await service.get(cisoActor(), {});
      expect(byDefault.period.key).toBe("2026-12");
    } finally {
      Object.assign(service, { clock });
    }
  });

  it("refuses an unknown period with 400 and a contributor with 403", async () => {
    expect((await board("cora", "?period=1999-01")).status).toBe(400);
    expect((await board("rita")).status).toBe(403);
  });

  it("is all zeros on an empty installation", async () => {
    const { status, body } = await board("cora");
    expect(status).toBe(200);
    expect(body.facts).toEqual({
      openRisks: 0,
      aboveAppetite: 0,
      reported: 0,
      approved: 0,
      closed: 0,
      overdueActions: 0,
      reviewsDue: 0,
    });
    expect(body.topRisks).toEqual([]);
    expect(body.mapNow.total).toBe(0);
    expect(body.movement.every((w) => w.reported + w.approved + w.closed === 0)).toBe(true);
    expect(body.organisation).toBe("");
  });
});
