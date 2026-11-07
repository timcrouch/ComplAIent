import type { RiskListResponse, RiskMapResponse } from "@isms/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "../../src/identity/index.js";
import { RiskInsightsService } from "../../src/risks/index.js";
import { db, reportBody, risksHarness } from "./harness.js";

type Fields = {
  title?: string;
  likelihood?: number | null;
  impact?: number | null;
  residualLikelihood?: number | null;
  residualImpact?: number | null;
  treatment?: "mitigate" | "accept" | "transfer" | "avoid" | null;
  state?: "approved" | "closed";
  closedAt?: Date;
  createdAt?: Date;
};

describe("risk map, movement and the list's cell filter", () => {
  const h = risksHarness();
  beforeAll(() => h.start());
  beforeEach(() => h.reset());
  afterAll(() => h.stop());

  /** Reports a risk as Rita, then sets its fields directly. */
  const seed = async (fields: Fields = {}): Promise<string> => {
    const res = await h.post(
      "/api/v1/risks",
      reportBody({ title: fields.title ?? "A risk" }),
      "rita",
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = (res.body as { id: string }).id;
    const data = { ...fields };
    delete data.title;
    if (Object.keys(data).length > 0) await db.risk.update({ where: { id }, data });
    return id;
  };
  const map = async (who: Parameters<typeof h.get>[1], query = "") => {
    const res = await h.get(`/api/v1/risks/map${query}`, who);
    return { status: res.status, body: res.body as RiskMapResponse };
  };
  const sorted = (cells: RiskMapResponse["cells"]) =>
    [...cells].sort((a, b) => b.likelihood - a.likelihood || b.impact - a.impact);
  const cisoActor = (): Actor => ({
    userId: h.userIds.cora,
    email: "cora@example.test",
    authTime: 0,
    authTimeSource: "auth_time",
    roles: [{ role: "ciso", scope: { type: "organisation", id: null } }],
  });

  it("serves /risks/map as the map, not as a risk id", async () => {
    const res = await map("cora");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ basis: "inherent", cells: [], total: 0 });
  });

  it("counts inherent cells, with unscored risks apart", async () => {
    await seed({ likelihood: 4, impact: 4 });
    await seed({ likelihood: 4, impact: 4 });
    await seed({ likelihood: 2, impact: 3 });
    await seed();
    const { body } = await map("cora");
    expect(body.basis).toBe("inherent");
    // Ordered by likelihood descending, then impact ascending.
    expect(body.cells).toEqual([
      { likelihood: 4, impact: 4, count: 2 },
      { likelihood: 2, impact: 3, count: 1 },
    ]);
    expect(body).toMatchObject({ unscored: 1, total: 4, unplaced: 0 });
    expect(typeof body.appetiteThreshold).toBe("number");
  });

  it("leaves closed risks off the map unless includeClosed is true", async () => {
    await seed({ likelihood: 4, impact: 4 });
    await seed({ likelihood: 4, impact: 4, state: "closed", closedAt: new Date() });
    const byDefault = await map("cora");
    expect(byDefault.body).toMatchObject({
      total: 1,
      cells: [{ likelihood: 4, impact: 4, count: 1 }],
    });
    const explicitFalse = await map("cora", "?includeClosed=false");
    expect(explicitFalse.body.total).toBe(1);
    const included = await map("cora", "?includeClosed=true");
    expect(included.body).toMatchObject({
      total: 2,
      cells: [{ likelihood: 4, impact: 4, count: 2 }],
    });
    const closedOnlyForViewer = await map("vera", "?includeClosed=true");
    expect(closedOnlyForViewer.body.total).toBe(1);
  });

  it("places residual risks, accepted risks at their inherent position, and counts unplaced", async () => {
    await seed({
      likelihood: 4,
      impact: 4,
      treatment: "mitigate",
      residualLikelihood: 2,
      residualImpact: 2,
    });
    await seed({ likelihood: 3, impact: 3, treatment: "accept" });
    await seed({ likelihood: 4, impact: 4, treatment: "mitigate" });
    const { body } = await map("cora", "?basis=residual");
    expect(body.basis).toBe("residual");
    expect(sorted(body.cells)).toEqual([
      { likelihood: 3, impact: 3, count: 1 },
      { likelihood: 2, impact: 2, count: 1 },
    ]);
    expect(body).toMatchObject({ unplaced: 1, unscored: 0, total: 3 });
  });

  it("lists exactly the unplaced risks for filter=noExpectedScore", async () => {
    const scored = { likelihood: 4, impact: 4 };
    const mitigate = { ...scored, treatment: "mitigate" } as const;
    await seed({ title: "Placed", ...mitigate, residualLikelihood: 2, residualImpact: 2 });
    await seed({ title: "Accepted", ...scored, treatment: "accept" });
    await seed({ title: "Closed", ...mitigate, state: "closed", closedAt: new Date() });
    await seed({ title: "Half", ...mitigate, residualLikelihood: 2 });
    await seed({ title: "Unmitigated", ...mitigate });
    await seed({ title: "NoTreatment", ...scored });
    await seed({ title: "Unscored" });
    const siteA = await seed({ title: "SiteA", ...mitigate });
    await db.risk.update({ where: { id: siteA }, data: { siteId: h.sites.siteA } });
    const list = async (who: Parameters<typeof h.get>[1], query = "") => {
      const res = await h.get(`/api/v1/risks?filter=noExpectedScore${query}`, who);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return (res.body as RiskListResponse).items.map((i) => i.title).sort();
    };
    const all = await list("cora");
    expect(all).toEqual(["Half", "NoTreatment", "SiteA", "Unmitigated"]);
    expect((await map("cora", "?basis=residual")).body.unplaced).toBe(all.length);
    // Ruling R9: the list length equals the map's unplaced count with includeClosed off and on.
    // Closed risks join both only when includeClosed is set.
    const withClosed = await list("cora", "&includeClosed=true");
    expect(withClosed).toEqual(["Closed", ...all].sort());
    expect((await map("cora", "?basis=residual&includeClosed=true")).body.unplaced).toBe(
      withClosed.length,
    );
    const scoped = await list("olga");
    expect(scoped.length).toBeLessThan(all.length);
    expect(scoped).not.toContain("SiteA");
  });

  it("shows a viewer approved risks only, and refuses a contributor", async () => {
    await seed({ likelihood: 4, impact: 4, state: "approved" });
    await seed({ likelihood: 1, impact: 1 });
    const viewer = await map("vera");
    expect(viewer.status).toBe(200);
    expect(viewer.body.cells).toEqual([{ likelihood: 4, impact: 4, count: 1 }]);
    expect(viewer.body.total).toBe(1);
    expect((await map("carl")).status).toBe(403);
  });

  describe("the list's cell filter", () => {
    const titles = async (query: string) => {
      const res = await h.get(`/api/v1/risks${query}`, "cora");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return (res.body as RiskListResponse).items.map((i) => i.title).sort();
    };

    it("lists exactly the risks in an inherent cell", async () => {
      await seed({ title: "A", likelihood: 4, impact: 4 });
      await seed({ title: "B", likelihood: 4, impact: 4 });
      await seed({ title: "C", likelihood: 2, impact: 3 });
      await seed({ title: "D" });
      expect(await titles("?likelihood=4&impact=4")).toEqual(["A", "B"]);
    });

    it("lists the residual cell, with accepted risks at their inherent position", async () => {
      await seed({
        title: "R",
        likelihood: 4,
        impact: 4,
        treatment: "mitigate",
        residualLikelihood: 2,
        residualImpact: 2,
      });
      await seed({ title: "Acc", likelihood: 2, impact: 2, treatment: "accept" });
      await seed({ title: "Acc3", likelihood: 3, impact: 3, treatment: "accept" });
      await seed({ title: "Open", likelihood: 4, impact: 4, treatment: "mitigate" });
      expect(await titles("?basis=residual&likelihood=2&impact=2")).toEqual(["Acc", "R"]);
      expect(await titles("?basis=residual&likelihood=3&impact=3")).toEqual(["Acc3"]);
      expect(await titles("?basis=residual&likelihood=4&impact=4")).toEqual([]);
      expect(await titles("?likelihood=4&impact=4")).toEqual(["Open", "R"]);
    });

    it("combines a cell with filter=evidenceMissing", async () => {
      const control = await db.control.create({
        data: {
          code: "AST-01",
          title: "Asset inventory",
          description: "Keep a list of assets.",
          guidance: [],
          category: "assets",
          libraryVersion: "test",
        },
      });
      const inCell = await seed({ title: "In cell", likelihood: 4, impact: 4 });
      const otherCell = await seed({ title: "Other cell", likelihood: 2, impact: 3 });
      await seed({ title: "No control", likelihood: 4, impact: 4 });
      for (const riskId of [inCell, otherCell])
        await db.riskControl.create({
          data: { riskId, controlId: control.id, status: "accepted", source: "person" },
        });
      expect(await titles("?filter=evidenceMissing")).toEqual(["In cell", "Other cell"]);
      expect(await titles("?filter=evidenceMissing&likelihood=4&impact=4")).toEqual(["In cell"]);
      expect(await titles("?filter=evidenceMissing&likelihood=1&impact=1")).toEqual([]);
    });

    it("leaves closed risks out of a cell unless includeClosed is true (P6-R3)", async () => {
      const control = await db.control.create({
        data: {
          code: "AST-01",
          title: "Asset inventory",
          description: "Keep a list of assets.",
          guidance: [],
          category: "assets",
          libraryVersion: "test",
        },
      });
      await seed({ title: "Open", likelihood: 4, impact: 4 });
      const closed = await seed({
        title: "Closed",
        likelihood: 4,
        impact: 4,
        state: "closed",
        closedAt: new Date(),
      });
      await db.riskControl.create({
        data: { riskId: closed, controlId: control.id, status: "accepted", source: "person" },
      });
      const cell = "likelihood=4&impact=4";
      expect(await titles(`?${cell}`)).toEqual(["Open"]);
      expect(await titles(`?${cell}&includeClosed=false`)).toEqual(["Open"]);
      expect(await titles(`?${cell}&includeClosed=true`)).toEqual(["Closed", "Open"]);
      // The evidenceMissing path agrees.
      expect(await titles(`?filter=evidenceMissing&${cell}`)).toEqual([]);
      expect(await titles(`?filter=evidenceMissing&${cell}&includeClosed=true`)).toEqual([
        "Closed",
      ]);
      // Without a cell the list still shows closed risks; evidenceMissing counts open ones (P6-R8).
      expect(await titles("")).toEqual(["Closed", "Open"]);
      expect(await titles("?filter=evidenceMissing")).toEqual([]);
      expect(await titles("?filter=evidenceMissing&includeClosed=true")).toEqual(["Closed"]);
    });

    it("pages through one cell with a cursor", async () => {
      await seed({ title: "A", likelihood: 4, impact: 4 });
      await seed({ title: "B", likelihood: 4, impact: 4 });
      await seed({ title: "C", likelihood: 2, impact: 3 });
      const page = async (cursor?: string) => {
        const res = await h.get(
          `/api/v1/risks?likelihood=4&impact=4&limit=1${cursor ? `&cursor=${cursor}` : ""}`,
          "cora",
        );
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        return res.body as RiskListResponse;
      };
      const first = await page();
      expect(first.items).toHaveLength(1);
      expect(first.nextCursor).not.toBeNull();
      const second = await page(first.nextCursor ?? "");
      expect(second.items).toHaveLength(1);
      expect(second.nextCursor).toBeNull();
      const seen = [...first.items, ...second.items].map((i) => i.title).sort();
      expect(seen).toEqual(["A", "B"]);
    });

    it("refuses one-sided cells", async () => {
      expect((await h.get("/api/v1/risks?likelihood=4", "cora")).status).toBe(400);
      expect((await h.get("/api/v1/risks?impact=4", "cora")).status).toBe(400);
    });
  });

  describe("movement", () => {
    const now = new Date("2026-11-06T12:00:00Z"); // Friday; the week starts 2026-11-02
    const movement = () => h.service(RiskInsightsService).movement(cisoActor(), now);

    it("returns 12 zero weeks on an empty database", async () => {
      const weeks = await movement();
      expect(weeks).toHaveLength(12);
      expect(weeks.at(-1)?.weekStart).toBe("2026-11-02");
      expect(weeks.every((w) => w.reported === 0 && w.approved === 0 && w.closed === 0)).toBe(true);
    });

    it("buckets reports and approvals by UTC week", async () => {
      // Sunday 23:30 UTC belongs to the Monday 2026-10-26 week.
      const sunday = await seed({ createdAt: new Date("2026-11-01T23:30:00Z") });
      await seed({ createdAt: new Date("2026-11-02T00:30:00Z") });
      await seed({ createdAt: new Date("2026-11-04T10:00:00Z") });
      await seed({ createdAt: new Date("2025-01-01T10:00:00Z") }); // outside the window
      await db.approval.create({
        data: {
          riskId: sunday,
          version: 1,
          decision: "approved",
          approverId: h.userIds.april,
          snapshot: {},
          createdAt: new Date("2026-11-03T09:00:00Z"),
        },
      });
      await db.approval.create({
        data: {
          riskId: sunday,
          version: 2,
          decision: "returned",
          approverId: h.userIds.april,
          snapshot: {},
          createdAt: new Date("2026-11-03T09:00:00Z"),
        },
      });
      const weeks = await movement();
      const byWeek = Object.fromEntries(weeks.map((w) => [w.weekStart, w]));
      expect(byWeek["2026-10-26"]).toEqual({
        weekStart: "2026-10-26",
        reported: 1,
        approved: 0,
        closed: 0,
      });
      expect(byWeek["2026-11-02"]).toEqual({
        weekStart: "2026-11-02",
        reported: 2,
        approved: 1,
        closed: 0,
      });
      expect(weeks.reduce((n, w) => n + w.reported, 0)).toBe(3);
    });

    it("counts changes of state to closed from the version history, reassessed ones too", async () => {
      const id = await seed({ createdAt: new Date("2026-10-01T10:00:00Z") });
      const version = (v: number, state: string, changedFields: string[], at: string) =>
        db.riskVersion.create({
          data: {
            riskId: id,
            version: v,
            snapshot: { state },
            changedFields,
            changedById: h.userIds.cora,
            createdAt: new Date(at),
          },
        });
      await version(2, "closed", ["state", "closedAt"], "2026-10-27T09:00:00Z");
      // Reassessed, approved and closed again: each closing counts in its own week.
      await version(3, "proposed", ["state"], "2026-10-28T09:00:00Z");
      await version(4, "closed", ["state", "closedAt"], "2026-11-03T09:00:00Z");
      // A closed snapshot without a state change (a review confirmation) is not a closing.
      await version(5, "closed", ["nextReviewDue"], "2026-11-04T09:00:00Z");
      const weeks = await movement();
      const byWeek = Object.fromEntries(weeks.map((w) => [w.weekStart, w.closed]));
      expect(byWeek["2026-10-26"]).toBe(1);
      expect(byWeek["2026-11-02"]).toBe(1);
      expect(weeks.reduce((n, w) => n + w.closed, 0)).toBe(2);
    });
  });
});
