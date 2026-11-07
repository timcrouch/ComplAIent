import type {
  RiskDetailDto,
  RiskListResponse,
  RiskMapResponse,
  WorkspaceResponse,
} from "@isms/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WorkspaceModule } from "../../src/workspace/index.js";
import { type Who, db, reportBody, risksHarness } from "../risks/harness.js";

const DAY_MS = 24 * 3600 * 1000;
const isoDay = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * DAY_MS).toISOString().slice(0, 10);

describe("home workspace", () => {
  const h = risksHarness({ imports: [WorkspaceModule] });
  let controlId = "";
  beforeAll(() => h.start());
  beforeEach(async () => {
    await h.reset();
    // Score 9 is within appetite, 10 is above.
    await db.riskScale.create({
      data: { version: 1, appetiteThreshold: 9, createdById: h.userIds.admin },
    });
    controlId = (
      await db.control.create({
        data: {
          code: "AST-01",
          title: "Asset inventory",
          description: "Keep a list of assets.",
          guidance: [],
          category: "assets",
          libraryVersion: "test",
        },
      })
    ).id;
  });
  afterAll(() => h.stop());

  const workspace = async (who: Who) => {
    const res = await h.get("/api/v1/workspace", who);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as WorkspaceResponse;
  };

  /** A risk reported by `reporter`, then set directly to the given state and assessment. */
  async function risk(
    opts: {
      reporter?: Who;
      site?: "siteA" | "siteB";
      state?: "proposed" | "in_review" | "approved" | "returned" | "closed";
      likelihood?: number;
      impact?: number;
      accepted?: boolean;
      evidence?: boolean;
    } = {},
  ) {
    const res = await h.post(
      "/api/v1/risks",
      reportBody(opts.site ? { siteId: h.sites[opts.site] } : {}),
      opts.reporter ?? "rita",
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = (res.body as RiskDetailDto).id;
    await db.risk.update({
      where: { id },
      data: {
        state: opts.state ?? "proposed",
        likelihood: opts.likelihood ?? null,
        impact: opts.impact ?? null,
        ...(opts.state && opts.state !== "proposed"
          ? {
              treatment: "mitigate",
              ownerId: h.userIds.cora,
              reviewerId: h.userIds.cora,
            }
          : {}),
      },
    });
    if (opts.accepted)
      await db.riskControl.create({
        data: { riskId: id, controlId, status: "accepted", source: "person" },
      });
    if (opts.evidence) {
      const e = await db.evidence.create({
        data: {
          riskId: id,
          objectKey: `evidence/${id}`,
          fileName: "inventory.pdf",
          sha256: "a".repeat(64),
          sizeBytes: 10,
          mimeType: "application/pdf",
          uploadedById: h.userIds.cora,
          collectedAt: new Date(),
        },
      });
      await db.evidenceControl.create({
        data: { evidenceId: e.id, controlId },
      });
    }
    return id;
  }

  const task = (riskId: string, assignee: Who, dueInDays: number | null, title = "Upload") =>
    db.task.create({
      data: {
        kind: "evidence_request",
        title,
        assigneeId: h.userIds[assignee],
        requestedById: h.userIds.cora,
        riskId,
        controlId,
        dueDate: dueInDays === null ? null : new Date(isoDay(dueInDays)),
      },
    });

  it("a brand-new installation has no statements and zero dimensions", async () => {
    const ws = await workspace("cora");
    expect(ws.riskPicture?.map).toMatchObject({ cells: [], total: 0 });
    expect(
      ws.riskPicture?.movement.every((w) => w.reported === 0 && w.approved === 0 && w.closed === 0),
    ).toBe(true);
    expect({ ...ws, riskPicture: null }).toEqual({
      statements: [],
      dimensions: {
        risks: {
          total: 0,
          aboveAppetite: 0,
          proposed: 0,
          inReview: 0,
          approved: 0,
          returned: 0,
          closed: 0,
        },
        controls: { accepted: 0, withEvidence: 0, testedWithinInterval: 0 },
        evidence: { items: 0, missing: 0 },
        tasks: { open: 0, overdue: 0 },
      },
      riskPicture: null,
      myConcerns: [],
      myTasks: [],
    });
  });

  it("counts match the records: 1 above appetite, 1 evidence missing, 1 awaiting my approval", async () => {
    await risk({ state: "in_review", likelihood: 5, impact: 5 });
    const missing = await risk({ accepted: true });
    await risk({
      state: "approved",
      likelihood: 2,
      impact: 2,
      accepted: true,
      evidence: true,
    });
    await task(missing, "carl", -2);
    await task(missing, "april", 3);

    const april = await workspace("april");
    expect(april.statements).toEqual([
      {
        key: "approvalsWaiting",
        count: 1,
        href: "/risks?filter=awaitingMyApproval",
      },
      { key: "aboveAppetite", count: 1, href: "/risks?filter=aboveAppetite" },
      {
        key: "evidenceMissing",
        count: 1,
        href: "/risks?filter=evidenceMissing",
      },
      { key: "tasksOpen", count: 1, href: "/tasks" },
    ]);
    expect(april.dimensions).toEqual({
      risks: {
        total: 3,
        aboveAppetite: 1,
        proposed: 1,
        inReview: 1,
        approved: 1,
        returned: 0,
        closed: 0,
      },
      controls: { accepted: 2, withEvidence: 1, testedWithinInterval: 0 },
      evidence: { items: 1, missing: 1 },
      tasks: { open: 2, overdue: 1 },
    });

    // The CISO reviews but does not approve: the proposed risk is to review, nothing to approve.
    const cora = await workspace("cora");
    expect(cora.statements.map((s) => [s.key, s.count, s.href])).toEqual([
      ["toReview", 1, "/risks?filter=toReview"],
      ["aboveAppetite", 1, "/risks?filter=aboveAppetite"],
      ["evidenceMissing", 1, "/risks?filter=evidenceMissing"],
    ]);
  });

  it("counts accepted controls whose latest test is within the review interval", async () => {
    await risk({ state: "approved", likelihood: 2, impact: 2, accepted: true });
    await risk({ state: "approved", likelihood: 2, impact: 2, accepted: true });
    const tested = async () => (await workspace("cora")).dimensions?.controls.testedWithinInterval;
    expect(await tested()).toBe(0);

    const test = (daysAgo: number) =>
      db.controlTest.create({
        data: {
          controlId,
          testedOn: new Date(isoDay(-daysAgo)),
          result: "effective",
          method: "Sampled the inventory",
          testedById: h.userIds.cora,
        },
      });
    // Default interval is 12 months: a test 400 days ago is due.
    await test(400);
    expect(await tested()).toBe(0);
    await test(20);
    expect(await tested()).toBe(2);
    // With a one-month interval, a 60-day-old latest test is due; with twelve it was not.
    await db.organisation.create({ data: { name: "Acme", reviewIntervalMonths: 1 } });
    expect(await tested()).toBe(2);
    await db.controlTest.deleteMany({ where: { testedOn: new Date(isoDay(-20)) } });
    await test(60);
    expect(await tested()).toBe(0);
  });

  it("a contributor gets no dimensions, only their concerns and tasks", async () => {
    const inReview = await risk({
      state: "in_review",
      likelihood: 5,
      impact: 5,
    });
    const proposed = await risk({ accepted: true });
    const approved = await risk({
      state: "approved",
      likelihood: 2,
      impact: 2,
    });
    await risk({ reporter: "carl" });
    const late = await task(proposed, "rita", -1, "Late upload");
    const later = await task(approved, "rita", 5, "Later upload");
    await db.task.create({
      data: {
        kind: "evidence_request",
        title: "Done",
        assigneeId: h.userIds.rita,
        requestedById: h.userIds.cora,
        riskId: approved,
        controlId,
        status: "done",
        completedAt: new Date(),
      },
    });

    const rita = await workspace("rita");
    expect(rita.dimensions).toBeNull();
    expect(rita.statements).toEqual([
      { key: "tasksOpen", count: 2, href: "/tasks" },
      { key: "concernsUpdated", count: 2, href: "/concerns" },
    ]);
    const mine = await db.risk.findMany({
      where: { reporterId: h.userIds.rita },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: { id: true, reference: true, title: true, state: true, updatedAt: true },
    });
    expect(rita.myConcerns.map((c) => c.id).sort()).toEqual([inReview, proposed, approved].sort());
    expect(rita.myConcerns).toEqual(
      mine.map((m) => ({
        id: m.id,
        reference: `R-${String(m.reference).padStart(4, "0")}`,
        title: m.title,
        state: m.state,
        updatedAt: m.updatedAt.toISOString(),
      })),
    );
    // Rita reported both risks but cannot read risks: no link to them.
    const fields = { kind: "evidence_request", riskTitle: null, riskId: null };
    expect(rita.myTasks).toEqual([
      {
        id: late.id,
        title: "Late upload",
        dueDate: isoDay(-1),
        overdue: true,
        riskReference: expect.stringMatching(/^R-/) as string,
        ...fields,
      },
      {
        id: later.id,
        title: "Later upload",
        dueDate: isoDay(5),
        overdue: false,
        riskReference: expect.stringMatching(/^R-/) as string,
        ...fields,
      },
    ]);
  });

  it("lists at most five concerns and five tasks, and drops concerns updated over 14 days ago", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push(await risk({ state: "returned" }));
    for (const id of ids) await task(id, "rita", null);
    await db.risk.updateMany({
      where: { id: { in: ids.slice(0, 2) } },
      data: { updatedAt: new Date(Date.now() - 15 * DAY_MS) },
    });
    const rita = await workspace("rita");
    expect(rita.myConcerns).toHaveLength(5);
    expect(rita.myTasks).toHaveLength(5);
    expect(rita.statements).toEqual([
      { key: "tasksOpen", count: 6, href: "/tasks" },
      { key: "concernsUpdated", count: 4, href: "/concerns" },
    ]);
  });

  it("a site-scoped risk owner's counts include only their site", async () => {
    const atA = await risk({
      site: "siteA",
      likelihood: 5,
      impact: 5,
      accepted: true,
    });
    const atB = await risk({
      site: "siteB",
      likelihood: 5,
      impact: 5,
      accepted: true,
    });
    await risk({ site: "siteB", state: "approved", likelihood: 1, impact: 1 });
    await task(atA, "carl", -1);
    await task(atB, "carl", -1);
    await task(atB, "carl", 2);

    const oscar = await workspace("oscar");
    expect(oscar.statements).toEqual([
      { key: "toReview", count: 1, href: "/risks?filter=toReview" },
      { key: "aboveAppetite", count: 1, href: "/risks?filter=aboveAppetite" },
      {
        key: "evidenceMissing",
        count: 1,
        href: "/risks?filter=evidenceMissing",
      },
    ]);
    expect(oscar.dimensions).toEqual({
      risks: {
        total: 1,
        aboveAppetite: 1,
        proposed: 1,
        inReview: 0,
        approved: 0,
        returned: 0,
        closed: 0,
      },
      controls: { accepted: 1, withEvidence: 0, testedWithinInterval: 0 },
      evidence: { items: 0, missing: 1 },
      tasks: { open: 1, overdue: 1 },
    });
    const cora = await workspace("cora");
    expect(cora.dimensions?.risks.total).toBe(3);
    expect(cora.dimensions?.tasks).toEqual({ open: 3, overdue: 2 });
  });

  it("counts closed risks in the dimensions, and in the total", async () => {
    await risk({ state: "approved", likelihood: 2, impact: 2 });
    await risk({ state: "closed", likelihood: 2, impact: 2 });
    const risks = (await workspace("cora")).dimensions?.risks;
    expect(risks).toMatchObject({ approved: 1, closed: 1, total: 2 });
  });

  it("counts open risks only above appetite and missing evidence, as the filters list them (P6-R8)", async () => {
    await risk({ state: "approved", likelihood: 5, impact: 5, accepted: true });
    await risk({ state: "closed", likelihood: 5, impact: 5, accepted: true });
    const cora = await workspace("cora");
    expect(cora.statements.find((s) => s.key === "aboveAppetite")?.count).toBe(1);
    expect(cora.statements.find((s) => s.key === "evidenceMissing")?.count).toBe(1);
    expect(cora.dimensions?.risks).toMatchObject({ aboveAppetite: 1, total: 2, closed: 1 });
    expect(cora.dimensions?.evidence.missing).toBe(1);
    for (const filter of ["aboveAppetite", "evidenceMissing"]) {
      const list = await h.get(`/api/v1/risks?filter=${filter}`, "cora");
      expect(list.status, JSON.stringify(list.body)).toBe(200);
      const items = (list.body as RiskListResponse).items;
      expect(items.map((i) => i.state)).toEqual(["approved"]);
      const all = await h.get(`/api/v1/risks?filter=${filter}&includeClosed=true`, "cora");
      expect((all.body as RiskListResponse).items).toHaveLength(2);
    }
  });

  it("counts my overdue treatment actions, and every kind of task in the dimensions", async () => {
    const id = await risk({ state: "approved", likelihood: 2, impact: 2 });
    const make = (kind: "treatment_action" | "periodic_review", assignee: Who, due: number) =>
      db.task.create({
        data: {
          kind,
          title: "t",
          assigneeId: h.userIds[assignee],
          requestedById: h.userIds.cora,
          riskId: id,
          dueDate: new Date(isoDay(due)),
        },
      });
    await make("treatment_action", "carl", -3);
    await make("treatment_action", "carl", 3);
    await make("treatment_action", "rita", -1);
    await make("periodic_review", "carl", -1);
    await task(id, "carl", -1);
    const carl = await workspace("carl");
    expect(carl.statements.find((s) => s.key === "actionsOverdue")).toEqual({
      key: "actionsOverdue",
      count: 1,
      href: "/tasks",
    });
    expect(carl.statements.find((s) => s.key === "tasksOpen")?.count).toBe(4);
    const cora = await workspace("cora");
    expect(cora.dimensions?.tasks).toEqual({ open: 5, overdue: 4 });
    expect(cora.statements.some((s) => s.key === "actionsOverdue")).toBe(false);
  });

  it("counts approved and closed risks whose review is due, as the reviewDue filter lists them", async () => {
    const due = async (
      state: "approved" | "closed" | "proposed",
      days: number | null,
      site?: "siteA" | "siteB",
    ) => {
      const id = await risk(site ? { state, site } : { state });
      await db.risk.update({
        where: { id },
        data: { nextReviewDue: days === null ? null : new Date(isoDay(days)) },
      });
      return id;
    };
    await due("approved", -1);
    await due("closed", 0);
    await due("approved", 1);
    await due("approved", null);
    await due("proposed", -5);
    await due("approved", -2, "siteB");
    await due("approved", -3, "siteA");
    const cora = await workspace("cora");
    expect(cora.statements.find((s) => s.key === "reviewsDue")).toEqual({
      key: "reviewsDue",
      count: 4,
      href: "/risks?filter=reviewDue",
    });
    const list = await h.get("/api/v1/risks?filter=reviewDue", "cora");
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect((list.body as RiskListResponse).items).toHaveLength(4);
    const oscar = await workspace("oscar");
    expect(oscar.statements.find((s) => s.key === "reviewsDue")?.count).toBe(1);
  });

  describe("risk picture", () => {
    it("gives the CISO the inherent map from the map endpoint and 12 weeks of movement", async () => {
      await risk({ state: "approved", likelihood: 3, impact: 4 });
      await risk({ state: "in_review", likelihood: 3, impact: 4 });
      await risk({ reporter: "carl" });
      const res = await h.get("/api/v1/risks/map?basis=inherent", "cora");
      expect(res.status).toBe(200);
      const ws = await workspace("cora");
      expect(ws.riskPicture?.map).toEqual(res.body as RiskMapResponse);
      expect(ws.riskPicture?.map.cells).toEqual([{ likelihood: 3, impact: 4, count: 2 }]);
      expect(ws.riskPicture?.movement).toHaveLength(12);
      expect(ws.riskPicture?.movement.at(-1)?.reported).toBe(3);
    });

    it("gives a contributor no risk picture", async () => {
      await risk({ state: "approved", likelihood: 3, impact: 4 });
      expect((await workspace("rita")).riskPicture).toBeNull();
    });

    it("counts only approved risks for a viewer, in the map and in the movement", async () => {
      await risk({ state: "approved", likelihood: 2, impact: 2 });
      await risk({ state: "proposed", likelihood: 5, impact: 5 });
      const vera = (await workspace("vera")).riskPicture;
      expect(vera?.map.total).toBe(1);
      expect(vera?.map.cells).toEqual([{ likelihood: 2, impact: 2, count: 1 }]);
      expect(vera?.movement.reduce((n, w) => n + w.reported, 0)).toBe(1);
      const cora = (await workspace("cora")).riskPicture;
      expect(cora?.map.total).toBe(2);
      expect(cora?.movement.reduce((n, w) => n + w.reported, 0)).toBe(2);
    });
  });
});
