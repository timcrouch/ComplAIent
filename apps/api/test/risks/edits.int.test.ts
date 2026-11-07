import type { RiskDetailDto } from "@isms/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Who, audits, db, detailPaths, reportBody, risksHarness } from "./harness.js";

describe("risk edits: audit, concurrency and scope", () => {
  const h = risksHarness();
  beforeAll(() => h.start());
  beforeEach(() => h.reset());
  afterAll(() => h.stop());

  const report = async (overrides: Record<string, unknown> = {}) => {
    const res = await h.post("/api/v1/risks", reportBody(overrides), "rita");
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as RiskDetailDto;
  };
  const edit = (id: string, expectedVersion: number, changes: Record<string, unknown>, who: Who) =>
    h.patch(`/api/v1/risks/${id}`, { expectedVersion, changes }, who);

  it("audits free-text edits by length only, and numbers, enums and ids by value", async () => {
    const risk = await report({ toConfirm: ["Which floor?"] });
    const res = await edit(
      risk.id,
      1,
      {
        title: "Colleague Jane lost the laptop",
        scenario: "Jane left it on the 8:15 train.",
        toConfirm: [],
        assets: [
          { name: "Staff laptops", type: "device" },
          { name: "Customer files", type: "information" },
        ],
        likelihood: 3,
        treatment: "mitigate",
        siteId: h.sites.siteA,
      },
      "cora",
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const [audit] = await audits("risk.updated");
    const text = JSON.stringify(audit);
    for (const secret of ["Jane", "train", "Laptop left", "Which floor", "Customer files"])
      expect(text).not.toContain(secret);
    expect(audit?.beforeRef).toEqual({
      version: 1,
      toConfirm: { count: 1 },
      likelihood: null,
      treatment: null,
      siteId: null,
      assets: { count: 1 },
    });
    expect(audit?.afterRef).toEqual({
      version: 2,
      title: { changed: true, length: "Colleague Jane lost the laptop".length },
      scenario: { changed: true, length: "Jane left it on the 8:15 train.".length },
      toConfirm: { count: 0 },
      likelihood: 3,
      treatment: "mitigate",
      siteId: h.sites.siteA,
      assets: { count: 2 },
    });
  });

  it("two concurrent edits of one version: one succeeds, one is 409 staleVersion", async () => {
    const risk = await report();
    const results = await Promise.all([
      edit(risk.id, 1, { likelihood: 2 }, "cora"),
      edit(risk.id, 1, { likelihood: 5 }, "cora"),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const conflict = results.find((r) => r.status === 409);
    expect(conflict && detailPaths(conflict)).toEqual(["staleVersion"]);
    expect(await db.riskVersion.count({ where: { riskId: risk.id } })).toBe(2);
    expect((await db.risk.findUniqueOrThrow({ where: { id: risk.id } })).version).toBe(2);
  });

  it("a site-scoped risk owner edits at their own site but cannot move a risk away", async () => {
    const risk = await report({ siteId: h.sites.siteA });
    const ok = await edit(risk.id, 1, { likelihood: 2 }, "oscar");
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const moved = await edit(risk.id, 2, { siteId: h.sites.siteB }, "oscar");
    expect(moved.status).toBe(403);
    const toOrg = await edit(risk.id, 2, { siteId: null }, "oscar");
    expect(toOrg.status).toBe(403);
    expect((await db.risk.findUniqueOrThrow({ where: { id: risk.id } })).siteId).toBe(
      h.sites.siteA,
    );
  });

  it("moving a risk re-checks the current owner in the new scope", async () => {
    const risk = await report({ siteId: h.sites.siteA });
    expect((await edit(risk.id, 1, { ownerId: h.userIds.oscar }, "cora")).status).toBe(200);
    const res = await edit(risk.id, 2, { siteId: h.sites.siteB }, "cora");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: {
        details: [{ path: "changes.ownerId", message: "Owner not eligible in the new scope" }],
      },
    });
    // Moving together with an eligible new owner is fine.
    const both = await edit(risk.id, 2, { siteId: h.sites.siteB, ownerId: h.userIds.olga }, "cora");
    expect(both.status, JSON.stringify(both.body)).toBe(200);
    // An org-scoped CISO stays eligible wherever the risk goes.
    expect((await edit(risk.id, 3, { ownerId: h.userIds.cora }, "cora")).status).toBe(200);
    expect((await edit(risk.id, 4, { siteId: h.sites.siteA }, "cora")).status).toBe(200);
  });
});
