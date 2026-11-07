import type { RiskDetailDto, RiskListResponse } from "@isms/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { audits, db, detailPaths, reportBody, risksHarness } from "./harness.js";

describe("residual (expected after treatment) assessment", () => {
  const h = risksHarness();
  beforeAll(() => h.start());
  beforeEach(() => h.reset());
  afterAll(() => h.stop());

  const report = async () => {
    const res = await h.post("/api/v1/risks", reportBody(), "rita");
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as RiskDetailDto;
  };
  const edit = (id: string, expectedVersion: number, changes: Record<string, unknown>) =>
    h.patch(`/api/v1/risks/${id}`, { expectedVersion, changes }, "cora");
  /** A 4/4 mitigate risk at version 2. */
  const mitigated = async () => {
    const risk = await report();
    const res = await edit(risk.id, 1, { likelihood: 4, impact: 4, treatment: "mitigate" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return risk.id;
  };

  it("stores a residual of 2/2, versions it and audits it", async () => {
    const id = await mitigated();
    const res = await edit(id, 2, { residualLikelihood: 2, residualImpact: 2 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = res.body as RiskDetailDto;
    expect(body.residualLikelihood).toBe(2);
    expect(body.residualImpact).toBe(2);
    expect(body.history[0]?.changedFields).toEqual(["residualLikelihood", "residualImpact"]);
    const rows = await audits("risk.updated");
    expect(rows.some((a) => JSON.stringify(a.afterRef).includes('"residualLikelihood":2'))).toBe(
      true,
    );
  });

  it("rejects a residual above the inherent value on the residual field", async () => {
    const id = await mitigated();
    const res = await edit(id, 2, { residualLikelihood: 5, residualImpact: 1 });
    expect(res.status).toBe(400);
    expect(detailPaths(res)).toEqual(["changes.residualLikelihood"]);
  });

  it("reports on the inherent field when the edit lowers it below the residual", async () => {
    const id = await mitigated();
    expect((await edit(id, 2, { residualLikelihood: 2, residualImpact: 2 })).status).toBe(200);
    const res = await edit(id, 3, { likelihood: 1 });
    expect(res.status).toBe(400);
    expect(detailPaths(res)).toEqual(["changes.likelihood"]);
  });

  it("rejects a residual on an accepted risk", async () => {
    const risk = await report();
    const res = await edit(risk.id, 1, {
      likelihood: 3,
      impact: 3,
      treatment: "accept",
      residualLikelihood: 1,
    });
    expect(res.status).toBe(400);
    expect(detailPaths(res)).toEqual(["changes.residualLikelihood"]);
  });

  it("clears the residual when treatment changes to accept", async () => {
    const id = await mitigated();
    expect((await edit(id, 2, { residualLikelihood: 2, residualImpact: 2 })).status).toBe(200);
    const res = await edit(id, 3, { treatment: "accept" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = res.body as RiskDetailDto;
    expect(body.residualLikelihood).toBeNull();
    expect(body.residualImpact).toBeNull();
    expect(body.history[0]?.changedFields).toEqual([
      "treatment",
      "residualLikelihood",
      "residualImpact",
    ]);
  });

  it("shows residualScore on the list only when both values are set", async () => {
    const id = await mitigated();
    const score = async () => {
      const res = await h.get("/api/v1/risks", "cora");
      return (res.body as RiskListResponse).items.find((i) => i.id === id);
    };
    expect(await edit(id, 2, { residualLikelihood: 2 })).toHaveProperty("status", 200);
    expect((await score())?.residualScore).toBeNull();
    expect((await score())?.residualAboveAppetite).toBeNull();
    expect((await edit(id, 3, { residualImpact: 2 })).status).toBe(200);
    expect((await score())?.residualScore).toBe(4);
    expect(typeof (await score())?.residualAboveAppetite).toBe("boolean");
  });

  it("an accepted risk's expected score equals its inherent score", async () => {
    const risk = await report();
    const res = await edit(risk.id, 1, { likelihood: 4, impact: 4, treatment: "accept" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const list = await h.get("/api/v1/risks", "cora");
    const item = (list.body as RiskListResponse).items.find((i) => i.id === risk.id);
    expect(item?.residualScore).toBe(16);
    expect(item?.residualAboveAppetite).toBe(true);
  });

  it.each([
    ["residualLikelihood", "Risk_residualLikelihood_check"],
    ["residualImpact", "Risk_residualImpact_check"],
  ])("the database refuses a %s of 6", async (column, constraint) => {
    const id = await mitigated();
    await expect(
      db.$executeRawUnsafe(`UPDATE "Risk" SET "${column}" = 6 WHERE id = '${id}'::uuid`),
    ).rejects.toThrow(constraint);
  });
});
