import type { AiSystemDetailDto } from "@isms/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SYSTEMS, type Who, aiActHarness, audits, db, detailPaths } from "./harness.js";

describe("linking AI systems to risks", () => {
  const h = aiActHarness();
  beforeAll(() => h.start());
  beforeEach(async () => {
    await h.reset();
    await h.enableModule();
  });
  afterAll(() => h.stop());

  const link = (id: string, riskId: string, who: Who = "cora") =>
    h.post(`${SYSTEMS}/${id}/risks`, { riskId }, who);
  const unlink = (id: string, riskId: string, who: Who = "cora") =>
    h.delete(`${SYSTEMS}/${id}/risks/${riskId}`, {}, who);
  const linkedTitles = async (id: string, who: Who) => {
    const res = await h.get(`${SYSTEMS}/${id}`, who);
    expect(res.status, who).toBe(200);
    return (res.body as AiSystemDetailDto).risks.map((r) => r.title);
  };

  it("links and unlinks a risk, audited by id and reference, never by title", async () => {
    const { id } = await h.createSystem();
    const riskId = await h.insertRisk("Scoring bias against young applicants");
    const res = await link(id, riskId);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const [linked] = (res.body as AiSystemDetailDto).risks;
    expect(linked).toMatchObject({
      id: riskId,
      title: "Scoring bias against young applicants",
      state: "proposed",
      linkedBy: { id: h.userIds.cora },
    });
    expect(linked?.reference).toMatch(/^R-\d{4}$/);
    expect(detailPaths(await link(id, riskId))).toEqual(["duplicateAiSystemRisk"]);

    const removed = await unlink(id, riskId);
    expect(removed.status).toBe(200);
    expect((removed.body as AiSystemDetailDto).risks).toEqual([]);
    expect((await unlink(id, riskId)).status).toBe(404);

    const [on] = await audits("ai_system.risk_linked");
    const [off] = await audits("ai_system.risk_unlinked");
    expect(on).toMatchObject({ objectType: "AiSystem", objectId: id });
    expect(on?.afterRef).toEqual({ riskId, riskReference: linked?.reference });
    expect(off?.beforeRef).toEqual({ riskId, riskReference: linked?.reference });
    expect(JSON.stringify([on, off])).not.toContain("young applicants");
  });

  it("returns only links to risks the reader may see", async () => {
    const { id } = await h.createSystem();
    const proposedB = await h.insertRisk("Proposed at Berlin", { site: "siteB" });
    const approvedB = await h.insertRisk("Approved at Berlin", {
      site: "siteB",
      state: "approved",
    });
    const proposedA = await h.insertRisk("Proposed at Riga", { site: "siteA" });
    for (const riskId of [proposedB, approvedB, proposedA]) await link(id, riskId);

    expect(await linkedTitles(id, "cora")).toHaveLength(3);
    // An organisation viewer sees approved and closed risks only.
    expect(await linkedTitles(id, "vera")).toEqual(["Approved at Berlin"]);
    // Oscar owns risks at Riga (site-scoped, full sight there) and views the organisation.
    await h.grant("oscar", "viewer", "org");
    expect((await linkedTitles(id, "oscar")).sort()).toEqual([
      "Approved at Berlin",
      "Proposed at Riga",
    ]);
    // An administrator reads the register but not risks: no links at all.
    expect(await linkedTitles(id, "admin")).toEqual([]);
    expect(await db.aiSystemRisk.count()).toBe(3);
  });

  it("404s a risk that is not there, as for one the actor may not see", async () => {
    // Every role holding aiact.manage (ciso, risk_owner, organisation-wide) sees every risk,
    // so the visibility rule on link and unlink is the same riskVisibilityWhere as the read.
    const { id } = await h.createSystem();
    const missing = "0190a6f2-0000-7000-8000-0000000000cc";
    expect((await link(id, missing)).status).toBe(404);
    expect((await unlink(id, missing)).status).toBe(404);
  });

  it("needs aiact.manage for the route, and 404s an unknown system", async () => {
    const { id } = await h.createSystem();
    const riskId = await h.insertRisk("A risk", { state: "approved" });
    for (const who of ["vera", "aldo", "april", "admin"] as const)
      expect((await link(id, riskId, who)).status, who).toBe(403);
    await h.grant("olga", "risk_owner", "org");
    expect((await link(id, riskId, "olga")).status).toBe(201);
    expect((await unlink(id, riskId, "olga")).status).toBe(200);
    expect((await link("0190a6f2-0000-7000-8000-0000000000dd", riskId)).status).toBe(404);
  });
});
