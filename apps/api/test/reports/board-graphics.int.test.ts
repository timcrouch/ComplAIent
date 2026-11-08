import type { BoardPackResponse } from "@isms/contracts";
import { BOARD_TILES, type BoardPeriod, formatRiskReference } from "@isms/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "../../src/identity/index.js";
import { NarrativeService } from "../../src/reports/narrative.service.js";
import { db } from "../risks/harness.js";
import { reportsHarness } from "./harness.js";

const NOW = new Date("2026-11-06T12:00:00Z");
const noon = (day: string) => new Date(`${day}T12:00:00Z`);

type Step = { day: string; state: string; likelihood?: number | null; impact?: number | null };

/**
 * Board graphics over version history (Plan 8 Task 3), with the clock fixed at 2026-11-06 and
 * the period 2026-10 (previous: 2026-09; weeks Aug 10 … Oct 26). The seeded history:
 * - A (Oscar, site A, 5×5): reported 20 Aug, approved 2 Sep, closed 9 Sep (week 5), reassessed
 *   30 Sep (week 8); open now.
 * - B (Oscar, site A, 2×2): reported 15 Sep; closed 5 Oct, reassessed 12 Oct, closed 20 Oct.
 * - C (Olga, site B, 4×4): reported 10 Oct, approved 12 Oct.
 * - D (unassigned, 3×4): reported 5 Sep; an overdue action.
 * - E (unassigned, 5×5): reported 3 Nov, after the period.
 * - F (Olga, site B): reported 1 Jul at 5×5, approved 16 Oct, reassessed to 1×2 on 15 Oct.
 */
describe("board graphics", () => {
  const h = reportsHarness({ clock: { now: () => NOW } });
  beforeAll(() => h.start());
  beforeEach(async () => {
    await h.reset();
    await h.grant("carl", "auditor", "siteA");
  });
  afterAll(() => h.stop());

  const board = async (who: Parameters<typeof h.get>[1], period = "2026-10") => {
    const res = await h.get(`/api/v1/reports/board?period=${period}`, who);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as BoardPackResponse;
  };

  /** Replaces the risk's version history with `steps` (backdated, at noon UTC). */
  async function history(riskId: string, steps: Step[]) {
    await db.riskVersion.deleteMany({ where: { riskId } });
    let previous: Step | undefined;
    for (const [i, step] of steps.entries()) {
      const changed = ["state", "likelihood", "impact"].filter(
        (f) => previous === undefined || previous[f as keyof Step] !== step[f as keyof Step],
      );
      await db.riskVersion.create({
        data: {
          riskId,
          version: i + 1,
          snapshot: {
            state: step.state,
            likelihood: step.likelihood ?? null,
            impact: step.impact ?? null,
          },
          changedFields: i === 0 ? [] : changed,
          changedById: h.userIds.cora,
          createdAt: noon(step.day),
        },
      });
      previous = step;
    }
  }

  const approve = (riskId: string, day: string) =>
    db.approval.create({
      data: {
        riskId,
        version: 1,
        decision: "approved",
        approverId: h.userIds.april,
        snapshot: {},
        createdAt: noon(day),
      },
    });

  const overdueAction = (riskId: string, due: string) =>
    db.task.create({
      data: {
        kind: "treatment_action",
        title: "Act",
        assigneeId: h.userIds.oscar,
        requestedById: h.userIds.cora,
        riskId,
        status: "open",
        dueDate: new Date(`${due}T00:00:00Z`),
      },
    });

  async function seed() {
    const risk = async (
      fields: Record<string, unknown>,
      site: "siteA" | "siteB" | undefined,
      steps: Step[],
    ) => {
      const r = await h.seedRisk(
        { ...fields, createdAt: noon(steps[0]?.day ?? "2026-01-01") },
        site,
      );
      await history(r.id, steps);
      return r;
    };
    const A = await risk(
      { title: "A", likelihood: 5, impact: 5, state: "approved", ownerId: h.userIds.oscar },
      "siteA",
      [
        { day: "2026-08-20", state: "proposed", likelihood: 5, impact: 5 },
        { day: "2026-09-09", state: "closed", likelihood: 5, impact: 5 },
        { day: "2026-09-30", state: "approved", likelihood: 5, impact: 5 },
      ],
    );
    await approve(A.id, "2026-09-02");
    await overdueAction(A.id, "2026-11-01");
    const B = await risk(
      { title: "B", likelihood: 2, impact: 2, state: "closed", ownerId: h.userIds.oscar },
      "siteA",
      [
        { day: "2026-09-15", state: "proposed", likelihood: 2, impact: 2 },
        { day: "2026-10-05", state: "closed", likelihood: 2, impact: 2 },
        { day: "2026-10-12", state: "approved", likelihood: 2, impact: 2 },
        { day: "2026-10-20", state: "closed", likelihood: 2, impact: 2 },
      ],
    );
    const C = await risk(
      { title: "C", likelihood: 4, impact: 4, state: "approved", ownerId: h.userIds.olga },
      "siteB",
      [{ day: "2026-10-10", state: "proposed", likelihood: 4, impact: 4 }],
    );
    await approve(C.id, "2026-10-12");
    // Not overdue: due after today.
    await overdueAction(C.id, "2026-12-01");
    const D = await risk({ title: "D", likelihood: 3, impact: 4 }, undefined, [
      { day: "2026-09-05", state: "proposed", likelihood: 3, impact: 4 },
    ]);
    await overdueAction(D.id, "2026-11-05");
    const E = await risk({ title: "E", likelihood: 5, impact: 5 }, undefined, [
      { day: "2026-11-03", state: "proposed", likelihood: 5, impact: 5 },
    ]);
    const F = await risk(
      { title: "F", likelihood: 1, impact: 2, state: "approved", ownerId: h.userIds.olga },
      "siteB",
      [
        { day: "2026-07-01", state: "proposed", likelihood: 5, impact: 5 },
        { day: "2026-10-15", state: "approved", likelihood: 1, impact: 2 },
      ],
    );
    await approve(F.id, "2026-10-16");
    return { A, B, C, D, E, F };
  }

  const september: BoardPeriod = { key: "2026-09", start: "2026-09-01", end: "2026-09-30" };
  const tile = (pack: BoardPackResponse, key: string) => pack.tiles.find((t) => t.key === key);

  it("builds tiles with change lines against the previous period and the period start", async () => {
    await seed();
    const pack = await board("cora");
    expect(pack.tiles.map((t) => t.key)).toEqual(BOARD_TILES.map((t) => t.key));
    const vsSeptember = { kind: "previousPeriod", period: september };
    const sinceStart = { kind: "since", date: "2026-10-01" };
    expect(pack.tiles).toEqual([
      // Now 5 (A C D E F); at 1 Oct 4 (A B D F).
      {
        key: "openRisks",
        value: 5,
        change: { delta: 1, direction: "up", tone: "neutral", basis: sinceStart },
      },
      // Now 4 (A C D E); at 1 Oct 3 (A D F at 5×5 then).
      {
        key: "aboveAppetite",
        value: 4,
        change: { delta: 1, direction: "up", tone: "worse", basis: sinceStart },
      },
      // October C; September B D.
      {
        key: "reported",
        value: 1,
        change: { delta: 1, direction: "down", tone: "neutral", basis: vsSeptember },
      },
      // October C F; September A.
      {
        key: "approved",
        value: 2,
        change: { delta: 1, direction: "up", tone: "neutral", basis: vsSeptember },
      },
      // October B (closed twice, counted once); September A.
      {
        key: "closed",
        value: 1,
        change: { delta: 0, direction: "same", tone: "neutral", basis: vsSeptember },
      },
      { key: "overdueActions", value: 2, change: null },
      { key: "reviewsDue", value: 0, change: null },
    ]);
    expect(pack.facts.closed).toBe(1);
  });

  it("moves over the 12 weeks ending with the period, with open risks from history", async () => {
    await seed();
    const pack = await board("cora");
    expect(pack.movement).toHaveLength(12);
    expect(pack.movement[0]?.weekStart).toBe("2026-08-10");
    expect(pack.movement.at(-1)?.weekStart).toBe("2026-10-26");
    const column = (key: "reported" | "approved" | "closed" | "openAtEnd") =>
      pack.movement.map((w) => w[key]);
    // E (3 Nov) is after the last week: not in it.
    expect(column("reported")).toEqual([0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 0, 0]);
    expect(column("approved")).toEqual([0, 0, 0, 1, 0, 0, 0, 0, 0, 2, 0, 0]);
    expect(column("closed")).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0]);
    // A leaves the line in week 5 (closed 9 Sep) and returns in week 8 (reassessed 30 Sep).
    expect(column("openAtEnd")).toEqual([1, 2, 2, 3, 2, 3, 3, 4, 4, 5, 4, 4]);
  });

  it("ends a past period's last movement week at the period end (M1)", async () => {
    await seed();
    const G = await h.seedRisk({
      title: "G",
      likelihood: 2,
      impact: 2,
      createdAt: noon("2026-10-02"),
    });
    await history(G.id, [{ day: "2026-10-02", state: "proposed", likelihood: 2, impact: 2 }]);
    const pack = await board("cora", "2026-09");
    expect(pack.movement.at(-1)?.weekStart).toBe("2026-09-28");
    // G (2 Oct) falls after 30 Sep: not reported in the last week and not open at its end (the
    // October pack, whose same week runs to 5 Oct, does count it).
    expect(pack.movement.at(-1)).toMatchObject({ reported: 0 });
    const open = pack.movement.at(-1)?.openAtEnd ?? 0;
    const october = (await board("cora", "2026-10")).movement.find(
      (w) => w.weekStart === "2026-09-28",
    );
    expect(open).toBe((october?.openAtEnd ?? 0) - 1);
  });

  it("breaks the risks out by owner, sorted by open then name, Unassigned last", async () => {
    await seed();
    const pack = await board("cora");
    expect(pack.owners).toEqual([
      {
        ownerId: h.userIds.olga,
        owner: "Olga Owner",
        owned: 2,
        open: 2,
        closedNow: 0,
        treatedInPeriod: 0,
        overdueActions: 0,
      },
      {
        ownerId: null,
        owner: null,
        owned: 2,
        open: 2,
        closedNow: 0,
        treatedInPeriod: 0,
        overdueActions: 1,
      },
      // B is closed now and treated once in October although closed twice.
      {
        ownerId: h.userIds.oscar,
        owner: "Oscar Owner",
        owned: 2,
        open: 1,
        closedNow: 1,
        treatedInPeriod: 1,
        overdueActions: 1,
      },
    ]);
    for (const row of pack.owners) expect(row.open + row.closedNow).toBe(row.owned);
  });

  it("counts a risk closed then reassessed in the period as open and treated (Review Focus 2)", async () => {
    await seed();
    // A: closed 9 Sep, reassessed 30 Sep, open now.
    const pack = await board("cora", "2026-09");
    const oscar = pack.owners.find((o) => o.ownerId === h.userIds.oscar);
    expect(oscar).toMatchObject({ open: 1, treatedInPeriod: 1 });
  });

  it("shows a site-scoped auditor only that site's owners and figures", async () => {
    await seed();
    const pack = await board("carl");
    expect(pack.owners.map((o) => o.owner)).toEqual(["Oscar Owner"]);
    expect(pack.owners[0]).toMatchObject({ owned: 2, open: 1, treatedInPeriod: 1 });
    expect(tile(pack, "openRisks")).toMatchObject({
      value: 1,
      change: { delta: 1, direction: "down" },
    });
    expect(tile(pack, "aboveAppetite")).toMatchObject({
      value: 1,
      change: { delta: 0, direction: "same", tone: "neutral" },
    });
    expect(pack.movement.map((w) => w.openAtEnd)).toEqual([0, 1, 1, 1, 0, 1, 1, 2, 1, 2, 1, 1]);
    expect(pack.movement.map((w) => w.reported)).toEqual([0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
  });

  it("gives a month before any data zeros at the start and exact changes, never null", async () => {
    await seed();
    const pack = await board("cora", "2026-05");
    expect(tile(pack, "openRisks")?.change).toEqual({
      delta: 5,
      direction: "up",
      tone: "neutral",
      basis: { kind: "since", date: "2026-05-01" },
    });
    expect(tile(pack, "aboveAppetite")?.change).toMatchObject({ delta: 4, tone: "worse" });
    for (const key of ["reported", "approved", "closed"])
      expect(tile(pack, key)).toMatchObject({
        value: 0,
        change: {
          delta: 0,
          direction: "same",
          basis: { kind: "previousPeriod", period: { key: "2026-04" } },
        },
      });
    expect(pack.movement.every((w) => w.openAtEnd === 0 && w.reported === 0)).toBe(true);
    expect(pack.owners.every((o) => o.treatedInPeriod === 0)).toBe(true);
  });

  it("is all zeros on an empty installation", async () => {
    const pack = await board("cora");
    expect(pack.owners).toEqual([]);
    expect(pack.movement.every((w) => w.openAtEnd === 0)).toBe(true);
    for (const t of pack.tiles) {
      expect(t.value).toBe(0);
      if (t.change !== null) expect(t.change).toMatchObject({ delta: 0, direction: "same" });
    }
  });

  it("keeps the narrative input to the facts and top risks", async () => {
    const { A, C, D, E } = await seed();
    const cora: Actor = {
      userId: h.userIds.cora,
      email: "cora@example.test",
      authTime: 0,
      authTimeSource: "auth_time",
      roles: [{ role: "ciso", scope: { type: "organisation", id: null } }],
    };
    const service = h.service(NarrativeService) as unknown as {
      input(actor: Actor, period: BoardPeriod): Promise<unknown>;
    };
    // A and C have owners (Oscar, Olga); the narrative input never carries them (#6).
    const top = (r: { reference: number }, title: string) => ({
      reference: formatRiskReference(r.reference),
      title,
      treatment: null,
    });
    const input = (await service.input(cora, {
      key: "2026-10",
      start: "2026-10-01",
      end: "2026-10-31",
    })) as { topRisks: Record<string, unknown>[] };
    for (const r of input.topRisks) expect(r).not.toHaveProperty("owner");
    expect(JSON.stringify(input)).not.toMatch(/Oscar|Olga/);
    expect(input).toEqual({
      period: { key: "2026-10", start: "2026-10-01", end: "2026-10-31" },
      facts: {
        openRisks: 5,
        aboveAppetite: 4,
        reported: 1,
        approved: 2,
        closed: 1,
        overdueActions: 2,
        reviewsDue: 0,
      },
      topRisks: [top(A, "A"), top(E, "E"), top(C, "C"), top(D, "D")],
    });
  });
});
