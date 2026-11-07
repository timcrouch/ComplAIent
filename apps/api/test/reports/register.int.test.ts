import type { RegisterResponse } from "@isms/contracts";
import { formatRiskReference } from "@isms/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, detailPaths } from "../risks/harness.js";
import { control, reportsHarness } from "./harness.js";

const DAY_MS = 86_400_000;
const day = (offset: number) =>
  new Date(`${new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10)}T00:00:00Z`);

describe("risk register report", () => {
  const h = reportsHarness();
  beforeAll(() => h.start());
  beforeEach(async () => {
    await h.reset();
    // Carl becomes an auditor of site A (Riga) only.
    await h.grant("carl", "auditor", "siteA");
    await db.organisation.create({ data: { name: "Acme Bank" } });
  });
  afterAll(() => h.stop());

  const register = async (who: Parameters<typeof h.get>[1], query = "") => {
    const res = await h.get(`/api/v1/reports/register${query}`, who);
    return { status: res.status, body: res.body as RegisterResponse, res };
  };

  /** Riga: approved, above appetite, with plan and control. Berlin: low. No site: unscored. */
  async function seedThree() {
    const gov = await control("GOV-01");
    const riga = await h.seedRisk(
      {
        title: "Riga risk",
        likelihood: 4,
        impact: 4,
        residualLikelihood: 2,
        residualImpact: 3,
        treatment: "mitigate",
        state: "approved",
        ownerId: h.userIds.oscar,
        approvedAt: new Date("2026-10-01T10:00:00Z"),
        nextReviewDue: new Date("2027-10-01T00:00:00Z"),
      },
      "siteA",
    );
    await db.approval.create({
      data: {
        riskId: riga.id,
        version: 1,
        decision: "approved",
        approverId: h.userIds.april,
        snapshot: {},
        createdAt: new Date("2026-10-01T10:00:00Z"),
      },
    });
    await db.riskControl.create({
      data: { riskId: riga.id, controlId: gov, status: "accepted", source: "person" },
    });
    const task = (status: "open" | "done" | "cancelled", dueDate: Date | null) =>
      db.task.create({
        data: {
          kind: "treatment_action",
          title: "Do it",
          assigneeId: h.userIds.oscar,
          requestedById: h.userIds.cora,
          riskId: riga.id,
          status,
          dueDate,
        },
      });
    await task("open", day(-3));
    await task("open", day(5));
    await task("done", day(-10));
    await task("cancelled", day(-10));
    const berlin = await h.seedRisk(
      { title: "Berlin risk", likelihood: 1, impact: 2, treatment: "accept" },
      "siteB",
    );
    const none = await h.seedRisk({ title: "Unsited risk" });
    return { riga, berlin, none };
  }

  it("lists every visible risk for the CISO, with the organisation scope", async () => {
    const { riga, berlin, none } = await seedThree();
    const { status, body } = await register("cora");
    expect(status).toBe(200);
    expect(body).toMatchObject({
      generatedBy: "Cora Ciso",
      organisation: "Acme Bank",
      scope: { kind: "organisation" },
      appetiteThreshold: 9,
      filter: "all",
      includeClosed: false,
    });
    expect(body.rows.map((r) => r.reference)).toEqual(
      [riga, berlin, none].map((r) => formatRiskReference(r.reference)),
    );
    expect(body.rows[0]).toEqual({
      reference: formatRiskReference(riga.reference),
      title: "Riga risk",
      owner: "Oscar Owner",
      site: "Riga",
      department: null,
      state: "approved",
      likelihood: 4,
      impact: 4,
      score: 16,
      aboveAppetite: true,
      treatment: "mitigate",
      residualLikelihood: 2,
      residualImpact: 3,
      residualScore: 6,
      controls: ["GOV-01"],
      openActions: 2,
      overdueActions: 1,
      nextReviewDue: "2027-10-01",
      approvedBy: "April Approver",
      approvedOn: "2026-10-01",
      closedOn: null,
    });
    // Accepted risks are expected to stay where they are (P5-R2).
    expect(body.rows[1]).toMatchObject({
      score: 2,
      aboveAppetite: false,
      residualLikelihood: 1,
      residualImpact: 2,
      residualScore: 2,
      approvedBy: null,
    });
    expect(body.rows[2]).toMatchObject({ score: null, aboveAppetite: null, site: null });
  });

  it("scopes a site auditor's register to the site and names it", async () => {
    const { riga } = await seedThree();
    const { status, body } = await register("carl");
    expect(status).toBe(200);
    expect(body.scope).toEqual({ kind: "units", names: ["Riga"] });
    expect(body.generatedBy).toBe("Carl Contributor");
    expect(body.rows.map((r) => r.reference)).toEqual([formatRiskReference(riga.reference)]);
  });

  it("passes the list filter through", async () => {
    const { riga } = await seedThree();
    const above = await register("cora", "?filter=aboveAppetite");
    expect(above.body.filter).toBe("aboveAppetite");
    expect(above.body.rows.map((r) => r.reference)).toEqual([formatRiskReference(riga.reference)]);
    const missing = await register("cora", "?filter=evidenceMissing");
    expect(missing.body.rows.map((r) => r.reference)).toEqual([
      formatRiskReference(riga.reference),
    ]);
    const mine = await register("cora", "?filter=reportedByMe");
    expect(mine.body.rows).toEqual([]);
    const bad = await register("cora", "?filter=nonsense");
    expect(bad.status).toBe(400);
  });

  it("refuses a contributor", async () => {
    expect((await register("rita")).status).toBe(403);
  });

  it("refuses more than 5000 rows with reportTooLarge", async () => {
    await db.risk.createMany({
      data: Array.from({ length: 5001 }, (_, i) => ({
        title: `Risk ${String(i)}`,
        scenario: "s",
        threat: "t",
        consequence: "c",
        toConfirm: [],
        reporterId: h.userIds.rita,
        aiAssisted: false,
      })),
    });
    const { status, res } = await register("cora");
    expect(status).toBe(409);
    expect(detailPaths(res)).toEqual(["reportTooLarge"]);
  });
});
