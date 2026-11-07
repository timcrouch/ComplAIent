import type { ControlListResponse, ControlOperationDto, ControlTestDto } from "@isms/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "../../src/identity/index.js";
import { LibraryModule } from "../../src/library/index.js";
import { ControlOperationService } from "../../src/risks/index.js";
import { type Who, audits, db, detailPaths, reportBody, risksHarness } from "../risks/harness.js";

const DAY_MS = 24 * 3600 * 1000;
const isoDay = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * DAY_MS).toISOString().slice(0, 10);

describe("controls in operation", () => {
  const h = risksHarness({ imports: [LibraryModule] });
  let controlId = "";
  beforeAll(() => h.start());
  beforeEach(async () => {
    await h.reset();
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
    await db.control.create({
      data: {
        code: "AST-02",
        title: "Unused",
        description: "Not on any risk.",
        guidance: [],
        category: "assets",
        libraryVersion: "test",
      },
    });
  });
  afterAll(() => h.stop());

  /** A risk reported by `reporter` with AST-01 accepted; optionally with linked evidence. */
  async function risk(opts: { reporter?: Who; site?: "siteA" | "siteB"; evidence?: boolean } = {}) {
    const res = await h.post(
      "/api/v1/risks",
      reportBody(opts.site ? { siteId: h.sites[opts.site] } : {}),
      opts.reporter ?? "rita",
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = (res.body as { id: string }).id;
    await db.risk.update({
      where: { id },
      data: { state: "approved", treatment: "mitigate", ownerId: h.userIds.cora },
    });
    await db.riskControl.create({
      data: { riskId: id, controlId, status: "accepted", source: "person" },
    });
    let evidenceId = "";
    if (opts.evidence) {
      evidenceId = (
        await db.evidence.create({
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
        })
      ).id;
      await db.evidenceControl.create({ data: { evidenceId, controlId } });
    }
    return { id, evidenceId };
  }

  const operation = async (who: Who) => {
    const res = await h.get("/api/v1/library/controls/AST-01/operation", who);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as ControlOperationDto;
  };
  const testBody = (over: Record<string, unknown> = {}) => ({
    testedOn: isoDay(0),
    result: "effective",
    method: "Sampled ten assets against the register",
    notes: "",
    evidenceIds: [],
    ...over,
  });
  const record = (body: Record<string, unknown>, who: Who = "cora") =>
    h.post("/api/v1/library/controls/AST-01/tests", body, who);

  it("records a test with linked evidence; the operation shows it as latest and not due", async () => {
    const { evidenceId } = await risk({ evidence: true });
    const before = await operation("cora");
    expect(before).toMatchObject({
      testDue: true,
      latest: null,
      evidenceCount: 1,
      canRecordTest: true,
    });
    expect(before.risks).toHaveLength(1);
    expect(before.evidenceOptions).toEqual([
      {
        id: evidenceId,
        fileName: "inventory.pdf",
        riskReference: expect.stringMatching(/^R-/) as string,
      },
    ]);

    const res = await record(testBody({ evidenceIds: [evidenceId], notes: "All present" }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const created = res.body as ControlTestDto;
    expect(created).toMatchObject({
      testedOn: isoDay(0),
      result: "effective",
      testedBy: { id: h.userIds.cora },
      evidence: [{ id: evidenceId, fileName: "inventory.pdf" }],
    });

    const after = await operation("cora");
    expect(after.testDue).toBe(false);
    expect(after.latest?.id).toBe(created.id);
    expect(after.tests.map((t) => t.id)).toEqual([created.id]);

    const [audit] = await audits("control.tested");
    expect(audit?.afterRef).toMatchObject({
      result: "effective",
      evidenceCount: 1,
      method: { length: 39 },
    });
  });

  it("is due again once the latest test is older than the review interval", async () => {
    await db.controlTest.create({
      data: {
        controlId,
        testedOn: new Date(isoDay(-400)),
        result: "ineffective",
        method: "Old test",
        testedById: h.userIds.cora,
      },
    });
    const op = await operation("cora");
    expect(op.testDue).toBe(true);
    expect(op.latest?.result).toBe("ineffective");
  });

  it("rejects evidence that is not linked to the control", async () => {
    const { id } = await risk();
    const other = await db.evidence.create({
      data: {
        riskId: id,
        objectKey: "evidence/unlinked",
        fileName: "other.pdf",
        sha256: "b".repeat(64),
        sizeBytes: 10,
        mimeType: "application/pdf",
        uploadedById: h.userIds.cora,
        collectedAt: new Date(),
      },
    });
    const res = await record(testBody({ evidenceIds: [other.id] }));
    expect(res.status).toBe(400);
    expect(detailPaths(res)).toEqual(["evidenceIds.0"]);
    expect(await db.controlTest.count()).toBe(0);
  });

  it("controls.test is organisation-level: a site-scoped risk owner cannot record or ask for steps (#24)", async () => {
    // A test sets the organisation-wide SoA status, so a site-scoped holder must not record one,
    // whether or not the control sits on a risk in their site.
    const { evidenceId } = await risk({ site: "siteA", evidence: true });
    expect((await record(testBody(), "oscar")).status).toBe(403);
    expect((await record(testBody({ evidenceIds: [evidenceId] }), "oscar")).status).toBe(403);
    const steps = await h.post("/api/v1/library/controls/AST-01/test-steps", {}, "oscar");
    expect(steps.status).toBe(403);
    expect(await db.controlTest.count()).toBe(0);
  });

  it("rejects evidence on a risk the actor cannot see, and shows them nothing of it", async () => {
    // The route needs an organisation-level holder, who sees every risk, so this goes to the
    // service with a site A risk owner: the risk is Rita's, on site B.
    const { evidenceId } = await risk({ site: "siteB", evidence: true });
    const svc = h.service(ControlOperationService);
    const oscar: Actor = {
      userId: h.userIds.oscar,
      email: "oscar@example.test",
      authTime: 0,
      authTimeSource: "auth_time",
      roles: [{ role: "risk_owner", scope: { type: "site", id: h.sites.siteA } }],
    };
    const ctx = { actorUserId: oscar.userId, requestId: "r" };
    await expect(
      svc.recordTest(oscar, "AST-01", testBody({ evidenceIds: [evidenceId] }) as never, ctx),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      details: [{ path: "evidenceIds.0" }],
    });
    expect(await svc.operation(oscar, "AST-01")).toMatchObject({
      risks: [],
      evidenceCount: 0,
      evidenceOptions: [],
    });
  });

  it("test history shows only evidence on risks the reader may see, counting the rest", async () => {
    const siteA = await risk({ site: "siteA", evidence: true });
    const siteB = await risk({ site: "siteB", evidence: true });
    const res = await record(testBody({ evidenceIds: [siteA.evidenceId, siteB.evidenceId] }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body as ControlTestDto).toMatchObject({ hiddenEvidenceCount: 0 });

    expect((await operation("cora")).latest).toMatchObject({ hiddenEvidenceCount: 0 });
    expect((await operation("cora")).latest?.evidence).toHaveLength(2);
    // Oscar owns site A only: he sees the site A evidence and a count of the rest.
    const scoped = (await operation("oscar")).latest;
    expect(scoped?.evidence.map((e) => e.id)).toEqual([siteA.evidenceId]);
    expect(scoped?.hiddenEvidenceCount).toBe(1);
    // An administrator reads the library but no risks: no evidence at all.
    const admin = (await operation("admin")).tests[0];
    expect(admin?.evidence).toEqual([]);
    expect(admin?.hiddenEvidenceCount).toBe(2);
  });

  it("a site-scoped risk owner can open the library list and a control's operation (P6-R5)", async () => {
    await risk({ site: "siteA" });
    const list = await h.get("/api/v1/library/controls", "oscar");
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const op = await h.get("/api/v1/library/controls/AST-01/operation", "oscar");
    expect(op.status, JSON.stringify(op.body)).toBe(200);
    // Reading is allowed at site scope; recording a test is organisation-level (#24).
    expect((op.body as ControlOperationDto).canRecordTest).toBe(false);
  });

  it("rejects a future test date", async () => {
    const res = await record(testBody({ testedOn: isoDay(2) }));
    expect(res.status).toBe(400);
    expect(detailPaths(res)).toEqual(["testedOn"]);
  });

  it("rejects an unknown control with 404", async () => {
    const res = await h.post("/api/v1/library/controls/AST-99/tests", testBody(), "cora");
    expect(res.status).toBe(404);
  });

  it("forbids a contributor; an auditor can read but not record", async () => {
    await risk();
    expect((await record(testBody(), "rita")).status).toBe(403);
    expect((await record(testBody(), "aldo")).status).toBe(403);
    const op = await operation("aldo");
    expect(op.canRecordTest).toBe(false);
    expect(op.risks).toHaveLength(1);
  });

  it("filters the library list by inUse and shows each control's latest result", async () => {
    await risk();
    expect((await record(testBody({ result: "partially_effective" }))).status).toBe(201);
    const list = async (query: string) => {
      const res = await h.get(`/api/v1/library/controls${query}`, "cora");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return (res.body as ControlListResponse).items.map((i) => [i.code, i.inUse, i.latestResult]);
    };
    expect(await list("")).toEqual([
      ["AST-01", true, "partially_effective"],
      ["AST-02", false, null],
    ]);
    expect(await list("?inUse=true")).toEqual([["AST-01", true, "partially_effective"]]);
    expect(await list("?inUse=false")).toEqual([["AST-02", false, null]]);
  });
});
