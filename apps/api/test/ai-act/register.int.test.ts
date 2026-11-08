import type { AiSystemDetailDto, AiSystemListResponse } from "@isms/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SYSTEMS, type Who, aiActHarness, audits, db, detailPaths } from "./harness.js";

describe("the AI system register", () => {
  const h = aiActHarness();
  beforeAll(() => h.start());
  beforeEach(async () => {
    await h.reset();
    await h.enableModule();
  });
  afterAll(() => h.stop());

  describe("permissions (#16 §2)", () => {
    it("lets every role but contributor read, organisation-scoped only", async () => {
      const { id } = await h.createSystem();
      const readers: Who[] = ["admin", "cora", "vera", "aldo", "april"];
      for (const who of readers) {
        expect((await h.get(SYSTEMS, who)).status, who).toBe(200);
        expect((await h.get(`${SYSTEMS}/${id}`, who)).status, who).toBe(200);
      }
      // A contributor, a site-scoped risk owner and a site-scoped contributor read nothing.
      for (const who of ["rita", "oscar", "sam"] as const) {
        expect((await h.get(SYSTEMS, who)).status, who).toBe(403);
        expect((await h.get(`${SYSTEMS}/${id}`, who)).status, who).toBe(403);
      }
    });

    it("lets ciso and an organisation-wide risk owner manage; nobody else", async () => {
      expect((await h.post(SYSTEMS, h.profile(), "cora")).status).toBe(201);
      for (const who of ["admin", "vera", "aldo", "april", "rita", "oscar"] as const) {
        const res = await h.post(SYSTEMS, h.profile({ name: `By ${who}` }), who);
        expect(res.status, who).toBe(403);
      }
      await h.grant("olga", "risk_owner", "org");
      expect((await h.post(SYSTEMS, h.profile({ name: "By Olga" }), "olga")).status).toBe(201);
    });
  });

  it("adds an unclassified system and audits it, free text by length only", async () => {
    const created = await h.createSystem({ departmentId: null });
    expect(created).toMatchObject({
      name: "Credit scoring engine",
      role: "deployer",
      status: "in_use",
      riskClass: "unclassified",
      owner: { id: h.userIds.oscar, displayName: "Oscar Owner" },
      department: null,
      classification: null,
      obligations: [],
      risks: [],
      openObligationCount: 0,
      canDraftClassification: false,
      canSuggestGuidance: false,
    });
    const [row] = await audits("ai_system.created");
    expect(row).toMatchObject({
      actorUserId: h.userIds.cora,
      objectType: "AiSystem",
      objectId: created.id,
    });
    expect(row?.afterRef).toMatchObject({
      name: "Credit scoring engine",
      role: "deployer",
      ownerId: h.userIds.oscar,
      description: { changed: true, length: created.description.length },
      intendedPurpose: { changed: true, length: created.intendedPurpose.length },
    });
    expect(JSON.stringify(row?.afterRef)).not.toContain("bureau data");
  });

  it("keeps names unique ignoring case and spaces (409 duplicateAiSystemName)", async () => {
    await h.createSystem();
    const res = await h.post(SYSTEMS, h.profile({ name: "  CREDIT scoring Engine " }), "cora");
    expect(res.status).toBe(409);
    expect(detailPaths(res)).toEqual(["duplicateAiSystemName"]);
    expect(await db.aiSystem.count()).toBe(1);
  });

  it("refuses an owner or department that does not exist (400)", async () => {
    const missing = "0190a6f2-0000-7000-8000-0000000000ff";
    expect(detailPaths(await h.post(SYSTEMS, h.profile({ ownerId: missing }), "cora"))).toEqual([
      "ownerId",
    ]);
    expect(
      detailPaths(await h.post(SYSTEMS, h.profile({ departmentId: missing }), "cora")),
    ).toEqual(["departmentId"]);
    expect(await db.aiSystem.count()).toBe(0);
  });

  it("changes only what differs, audits it, and never deletes", async () => {
    const created = await h.createSystem();
    const dept = await db.department.create({ data: { name: "Lending", nameKey: "lending" } });
    const res = await h.patch(
      `${SYSTEMS}/${created.id}`,
      {
        status: "retired",
        departmentId: dept.id,
        intendedPurpose: "No longer used.",
        name: created.name,
      },
      "cora",
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body as AiSystemDetailDto).toMatchObject({
      status: "retired",
      department: { id: dept.id, name: "Lending" },
      intendedPurpose: "No longer used.",
    });
    const [row] = await audits("ai_system.updated");
    expect(row?.beforeRef).toEqual({ status: "in_use", departmentId: null });
    expect(row?.afterRef).toEqual({
      changedFields: ["intendedPurpose", "status", "departmentId"],
      intendedPurpose: { changed: true, length: 15 },
      status: "retired",
      departmentId: dept.id,
    });

    // The same values again: nothing written, nothing audited.
    expect((await h.patch(`${SYSTEMS}/${created.id}`, { status: "retired" }, "cora")).status).toBe(
      200,
    );
    expect(await audits("ai_system.updated")).toHaveLength(1);
    // There is no delete route.
    expect((await h.delete(`${SYSTEMS}/${created.id}`, {}, "cora")).status).toBe(404);
    expect(await db.aiSystem.count()).toBe(1);
  });

  it("refuses a rename onto another system's name, and 404s an unknown system", async () => {
    await h.createSystem();
    const other = await h.createSystem({ name: "Chatbot" });
    const res = await h.patch(`${SYSTEMS}/${other.id}`, { name: "credit scoring engine" }, "cora");
    expect(detailPaths(res)).toEqual(["duplicateAiSystemName"]);
    const unknown = "0190a6f2-0000-7000-8000-0000000000ee";
    expect((await h.get(`${SYSTEMS}/${unknown}`, "cora")).status).toBe(404);
    expect((await h.patch(`${SYSTEMS}/${unknown}`, { status: "retired" }, "cora")).status).toBe(
      404,
    );
  });

  it("lists systems by name with their owner and open obligations", async () => {
    await h.createSystem({ name: "Zeta" });
    await h.createSystem({ name: "alpha" });
    const res = await h.get(SYSTEMS, "vera");
    const { systems } = res.body as AiSystemListResponse;
    expect(systems.map((s) => s.name)).toEqual(["alpha", "Zeta"]);
    expect(systems[0]).toMatchObject({
      riskClass: "unclassified",
      openObligationCount: 0,
      owner: { displayName: "Oscar Owner" },
    });
  });
});
