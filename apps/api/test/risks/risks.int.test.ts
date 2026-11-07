import type { RiskDetailDto, RiskListResponse } from "@isms/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Who, audits, db, detailPaths, reportBody, risksHarness } from "./harness.js";

describe("risks API: report, read, list and edit", () => {
  const h = risksHarness();
  beforeAll(() => h.start());
  beforeEach(() => h.reset());
  afterAll(() => h.stop());

  const report = async (who: Who = "rita", overrides: Record<string, unknown> = {}) => {
    const res = await h.post("/api/v1/risks", reportBody(overrides), who);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as RiskDetailDto;
  };
  const edit = (id: string, expectedVersion: number, changes: Record<string, unknown>, who: Who) =>
    h.patch(`/api/v1/risks/${id}`, { expectedVersion, changes }, who);
  const list = async (who: Who, query = "") => {
    const res = await h.get(`/api/v1/risks${query}`, who);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as RiskListResponse;
  };

  it("reports a risk as proposed, version 1, reference R-0001, not AI-assisted, audited", async () => {
    const risk = await report("rita");
    expect(risk).toMatchObject({
      reference: "R-0001",
      title: "Laptop left on the train",
      state: "proposed",
      version: 1,
      aiAssisted: false,
      aiEstimate: null,
      likelihood: null,
      impact: null,
      score: null,
      aboveAppetite: null,
      owner: null,
      reviewer: null,
      reporter: { id: h.userIds.rita, displayName: "Rita Reporter" },
      hasTranscript: false,
      controls: [],
      evidence: [],
      approval: null,
      assets: [{ id: expect.any(String) as string, name: "Staff laptops", type: "device" }],
      can: {
        edit: false,
        submit: false,
        approve: false,
        return: false,
        addEvidence: false,
        readTranscript: false,
      },
    });
    expect(risk.history).toEqual([
      expect.objectContaining({ version: 1, changedBy: risk.reporter }),
    ]);
    const versions = await db.riskVersion.findMany({ where: { riskId: risk.id } });
    expect(versions).toHaveLength(1);
    expect(versions[0]?.snapshot).toMatchObject({
      title: "Laptop left on the train",
      state: "proposed",
      assets: [{ name: "Staff laptops", type: "device" }],
      controls: [],
      closedAt: null,
      closedById: null,
      nextReviewDue: null,
    });
    const [audit] = await audits("risk.reported");
    expect(audit?.afterRef).toEqual({
      reference: "R-0001",
      titleLength: "Laptop left on the train".length,
      aiAssisted: false,
    });
    expect(JSON.stringify(audit)).not.toContain("train");
  });

  it("reuses an asset with the same name ignoring case and type", async () => {
    const a = await report("rita", {
      assets: [{ name: "Customer Database", type: "information" }],
    });
    const b = await report("carl", {
      assets: [
        { name: "customer database", type: "information" },
        { name: "Customer database", type: "application" },
      ],
    });
    expect(b.assets.find((x) => x.type === "information")?.id).toBe(a.assets[0]?.id);
    expect(await db.asset.count()).toBe(2);
    expect(await db.asset.findFirst({ where: { type: "information" } })).toMatchObject({
      name: "Customer Database",
      nameKey: "customer database",
    });
  });

  it("a contributor cannot read another person's risk: 404", async () => {
    // Contributors hold risks.report but not risks.read, so the read routes refuse them at
    // the guard (403) even for their own reports; they follow them under /me/concerns. A
    // caller with risks.read who may not see the risk gets 404, never 403.
    const risk = await report("rita");
    expect((await h.get(`/api/v1/risks/${risk.id}`, "carl")).status).toBe(403);
    expect((await h.get(`/api/v1/risks/${risk.id}`, "rita")).status).toBe(403);
    expect((await h.get("/api/v1/risks", "carl")).status).toBe(403);
    expect((await h.get(`/api/v1/risks/${risk.id}`, "vera")).status).toBe(404);
    expect((await h.get(`/api/v1/risks/${risk.id}`, "olga")).status).toBe(404);
    expect((await h.get(`/api/v1/risks/${risk.id}`, "cora")).status).toBe(200);
    // A viewer always sees what they reported themselves, even while proposed.
    const own = await report("vera");
    expect((await h.get(`/api/v1/risks/${own.id}`, "vera")).status).toBe(200);
    expect((await list("vera")).items.map((r) => r.id)).toEqual([own.id]);
  });

  it("edits create a version and audit only the changed fields", async () => {
    const risk = await report("rita");
    const res = await edit(risk.id, 1, { likelihood: 4, title: risk.title }, "cora");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const after = res.body as RiskDetailDto;
    expect(after).toMatchObject({ version: 2, likelihood: 4, score: null, can: { edit: true } });
    expect(after.history[0]).toMatchObject({
      version: 2,
      changedFields: ["likelihood"],
      changedBy: { id: h.userIds.cora, displayName: "Cora Ciso" },
    });
    const stored = await db.risk.findUniqueOrThrow({ where: { id: risk.id } });
    expect(stored.riskScaleId).toBeNull(); // no scale adopted yet
    const [audit] = await audits("risk.updated");
    expect(audit).toMatchObject({
      objectId: risk.id,
      beforeRef: { likelihood: null },
      afterRef: { likelihood: 4 },
    });

    const scale = await db.riskScale.create({
      data: { version: 1, appetiteThreshold: 6, createdById: h.userIds.admin },
    });
    const scored = await edit(risk.id, 2, { impact: 3 }, "cora");
    expect(scored.body).toMatchObject({ version: 3, score: 12, aboveAppetite: true });
    expect((await db.risk.findUniqueOrThrow({ where: { id: risk.id } })).riskScaleId).toBe(
      scale.id,
    );
    expect(await db.riskVersion.count({ where: { riskId: risk.id } })).toBe(3);
  });

  it("a stale expectedVersion is 409 staleVersion and changes nothing", async () => {
    const risk = await report("rita");
    expect((await edit(risk.id, 1, { likelihood: 2 }, "cora")).status).toBe(200);
    const res = await edit(risk.id, 1, { likelihood: 5 }, "cora");
    expect(res.status).toBe(409);
    expect(detailPaths(res)).toEqual(["staleVersion"]);
    expect(await db.risk.findUniqueOrThrow({ where: { id: risk.id } })).toMatchObject({
      likelihood: 2,
      version: 2,
    });
  });

  it("an approved risk is 409 riskNotEditable", async () => {
    const risk = await report("rita");
    await db.risk.update({ where: { id: risk.id }, data: { state: "approved" } });
    const res = await edit(risk.id, 1, { likelihood: 2 }, "cora");
    expect(res.status).toBe(409);
    expect(detailPaths(res)).toEqual(["riskNotEditable"]);
  });

  it("owner must hold risk_owner or ciso in the risk scope", async () => {
    const risk = await report("rita", { siteId: h.sites.siteA });
    const bad = await edit(risk.id, 1, { ownerId: h.userIds.olga }, "cora");
    expect(bad.status).toBe(400);
    expect(detailPaths(bad)).toEqual(["changes.ownerId"]);
    const contributor = await edit(risk.id, 1, { ownerId: h.userIds.carl }, "cora");
    expect(detailPaths(contributor)).toEqual(["changes.ownerId"]);
    const ok = await edit(risk.id, 1, { ownerId: h.userIds.oscar }, "cora");
    expect(ok.status).toBe(200);
    expect((ok.body as RiskDetailDto).owner).toEqual({
      id: h.userIds.oscar,
      displayName: "Oscar Owner",
    });
    // A site-B owner has no review rights on a site-A risk.
    expect((await edit(risk.id, 2, { likelihood: 1 }, "olga")).status).toBe(404);
    // An approver sees every risk but may not edit one.
    expect((await edit(risk.id, 2, { likelihood: 1 }, "april")).status).toBe(403);
  });

  it("toReview lists proposed and returned risks in the reviewer's scope only", async () => {
    const atA = await report("rita", { siteId: h.sites.siteA, title: "At A" });
    const atB = await report("rita", { siteId: h.sites.siteB, title: "At B" });
    const returned = await report("rita", { siteId: h.sites.siteA, title: "Returned at A" });
    const approved = await report("rita", { siteId: h.sites.siteA, title: "Approved at A" });
    await db.risk.update({ where: { id: returned.id }, data: { state: "returned" } });
    await db.risk.update({ where: { id: approved.id }, data: { state: "approved" } });

    const oscar = await list("oscar", "?filter=toReview");
    expect(oscar.items.map((r) => r.id).sort()).toEqual([atA.id, returned.id].sort());
    const cora = await list("cora", "?filter=toReview");
    expect(cora.items.map((r) => r.id).sort()).toEqual([atA.id, atB.id, returned.id].sort());
    expect((await list("april", "?filter=toReview")).items).toEqual([]);
    expect((await list("vera")).items.map((r) => r.id)).toEqual([approved.id]);
    expect((await list("aldo")).items).toHaveLength(4);
  });

  it("pages the list newest first with an opaque cursor", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await report("rita", { title: `Risk ${String(i)}` })).id);
    const first = await list("cora", "?limit=2");
    expect(first.items.map((r) => r.id)).toEqual([ids[4], ids[3]]);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await list("cora", `?limit=2&cursor=${first.nextCursor ?? ""}`);
    expect(second.items.map((r) => r.id)).toEqual([ids[2], ids[1]]);
    const third = await list("cora", `?limit=2&cursor=${second.nextCursor ?? ""}`);
    expect(third.items.map((r) => r.id)).toEqual([ids[0]]);
    expect(third.nextCursor).toBeNull();
    expect((await h.get("/api/v1/risks?cursor=nonsense", "cora")).status).toBe(400);
  });

  it("aboveAppetite lists only scored risks above the current threshold", async () => {
    await db.riskScale.create({
      data: { version: 1, appetiteThreshold: 8, createdById: h.userIds.admin },
    });
    const high = await report("rita", { title: "High" });
    const low = await report("rita", { title: "Low" });
    await report("rita", { title: "Unscored" });
    expect((await edit(high.id, 1, { likelihood: 3, impact: 3 }, "cora")).status).toBe(200);
    expect((await edit(low.id, 1, { likelihood: 2, impact: 4 }, "cora")).status).toBe(200);
    const above = await list("cora", "?filter=aboveAppetite");
    expect(above.items.map((r) => r.id)).toEqual([high.id]);
    expect(above.items[0]).toMatchObject({ score: 9, aboveAppetite: true });
  });

  it("the aboveAppetite filter and the DTO agree at the threshold and one above", async () => {
    await db.riskScale.create({
      data: { version: 1, appetiteThreshold: 8, createdById: h.userIds.admin },
    });
    const atThreshold = await report("rita", { title: "Score 8" });
    const above = await report("rita", { title: "Score 9" });
    expect((await edit(atThreshold.id, 1, { likelihood: 2, impact: 4 }, "cora")).status).toBe(200);
    expect((await edit(above.id, 1, { likelihood: 3, impact: 3 }, "cora")).status).toBe(200);
    const all = await list("cora");
    const filtered = await list("cora", "?filter=aboveAppetite");
    for (const item of all.items)
      expect(
        filtered.items.some((f) => f.id === item.id),
        item.title,
      ).toBe(item.aboveAppetite);
    expect(all.items.find((r) => r.id === atThreshold.id)).toMatchObject({
      score: 8,
      aboveAppetite: false,
    });
    expect(filtered.items.map((r) => r.id)).toEqual([above.id]);
    const detail = await h.get(`/api/v1/risks/${above.id}`, "cora");
    expect(detail.body).toMatchObject({ score: 9, aboveAppetite: true });
  });

  it("evidenceMissing lists risks with an accepted control lacking evidence on that risk", async () => {
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
    const missing = await report("rita", { title: "Missing", siteId: h.sites.siteA });
    const missingAtB = await report("rita", { title: "Missing at B", siteId: h.sites.siteB });
    const covered = await report("rita", { title: "Covered" });
    const suggested = await report("rita", { title: "Only suggested" });
    for (const [risk, status] of [
      [missing, "accepted"],
      [missingAtB, "accepted"],
      [covered, "accepted"],
      [suggested, "suggested"],
    ] as const)
      await db.riskControl.create({
        data: { riskId: risk.id, controlId: control.id, status, source: "person" },
      });
    const evidence = await db.evidence.create({
      data: {
        riskId: covered.id,
        objectKey: "evidence/covered",
        fileName: "inventory.pdf",
        sha256: "a".repeat(64),
        sizeBytes: 10,
        mimeType: "application/pdf",
        uploadedById: h.userIds.cora,
        collectedAt: new Date(),
      },
    });
    await db.evidenceControl.create({ data: { evidenceId: evidence.id, controlId: control.id } });
    const res = await list("cora", "?filter=evidenceMissing");
    expect(res.items.map((r) => r.id)).toEqual([missingAtB.id, missing.id]);
    // The raw query applies the same visibility: a site-A owner sees only site A.
    const oscar = await list("oscar", "?filter=evidenceMissing");
    expect(oscar.items.map((r) => r.id)).toEqual([missing.id]);
    const paged = await list("cora", "?filter=evidenceMissing&limit=1");
    expect(paged.items.map((r) => r.id)).toEqual([missingAtB.id]);
    const next = await list(
      "cora",
      `?filter=evidenceMissing&limit=1&cursor=${paged.nextCursor ?? ""}`,
    );
    expect(next.items.map((r) => r.id)).toEqual([missing.id]);
    expect(next.nextCursor).toBeNull();
    // A viewer sees no proposed risk, so nothing is missing for them.
    expect((await list("vera", "?filter=evidenceMissing")).items).toEqual([]);
    // Nothing is in review, so the approval queue is empty.
    expect((await list("april", "?filter=awaitingMyApproval")).items).toEqual([]);
  });

  it("/me/concerns lists only the actor's reports", async () => {
    const mine = await report("rita");
    await report("carl");
    const res = await h.get("/api/v1/me/concerns", "rita");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [
        {
          id: mine.id,
          reference: "R-0001",
          title: mine.title,
          state: "proposed",
          updatedAt: mine.updatedAt,
        },
      ],
    });
    expect((await h.get("/api/v1/me/concerns", "aldo")).status).toBe(403);
  });

  it("NUL in the title is 400, not 500", async () => {
    const res = await h.post("/api/v1/risks", reportBody({ title: "bad\u0000title" }), "rita");
    expect(res.status).toBe(400);
    expect(detailPaths(res)).toEqual(["title"]);
    const unknownSite = await h.post(
      "/api/v1/risks",
      reportBody({ siteId: "0190a000-0000-7000-8000-000000000000" }),
      "rita",
    );
    expect(unknownSite.status).toBe(400);
    expect(detailPaths(unknownSite)).toEqual(["siteId"]);
  });
});
