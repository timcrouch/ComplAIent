import type { RiskDetailDto, RiskListResponse } from "@isms/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RoleAssignmentService } from "../../src/identity/index.js";
import { type Who, audits, db, detailPaths, reportBody, risksHarness } from "./harness.js";

describe("approval with separation of duties", () => {
  const h = risksHarness();
  beforeAll(() => h.start());
  beforeEach(async () => {
    await h.reset();
    // Score 9 is within appetite, 10 is above.
    await db.riskScale.create({
      data: { version: 1, appetiteThreshold: 9, createdById: h.userIds.admin },
    });
  });
  afterAll(() => h.stop());

  const dto = (res: { body: unknown }) => res.body as RiskDetailDto;
  const path = (id: string, action: string) => `/api/v1/risks/${id}/${action}`;

  /** Gives `who` one more role, at the organisation unless a site is named; returns its id. */
  const grant = async (who: Who, role: "risk_approver" | "auditor", site?: "siteA" | "siteB") =>
    (
      await db.roleAssignment.create({
        data: {
          userId: h.userIds[who],
          role,
          grantedById: h.userIds.admin,
          ...(site ? { scopeType: "SITE", siteId: h.sites[site] } : { scopeType: "ORGANISATION" }),
        },
      })
    ).id;
  const removeRoles = (who: Who, role: string) =>
    db.roleAssignment.deleteMany({
      where: { userId: h.userIds[who], role: role as "risk_approver" },
    });

  async function report(who: Who = "rita", overrides: Record<string, unknown> = {}) {
    const res = await h.post("/api/v1/risks", reportBody(overrides), who);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return dto(res);
  }

  /** A complete risk, assessed by cora: version 2, ready to submit. */
  async function assessed(
    opts: {
      reporter?: Who;
      likelihood?: number;
      impact?: number;
      treatment?: string;
      site?: "siteA" | "siteB";
    } = {},
  ) {
    const risk = await report(
      opts.reporter ?? "rita",
      opts.site ? { siteId: h.sites[opts.site] } : {},
    );
    const res = await h.patch(
      `/api/v1/risks/${risk.id}`,
      {
        expectedVersion: 1,
        changes: {
          likelihood: opts.likelihood ?? 3,
          impact: opts.impact ?? 3,
          treatment: opts.treatment ?? "mitigate",
          ownerId: h.userIds.cora,
        },
      },
      "cora",
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return dto(res);
  }

  const submit = (id: string, expectedVersion: number, who: Who = "cora") =>
    h.post(path(id, "submit"), { expectedVersion }, who);
  const approve = (id: string, expectedVersion: number, who: Who, comment?: string) =>
    h.post(path(id, "approve"), { expectedVersion, ...(comment ? { comment } : {}) }, who);
  const giveBack = (id: string, body: Record<string, unknown>, who: Who) =>
    h.post(path(id, "return"), body, who);

  /** An assessed risk submitted by cora: version 3, in review. */
  async function submitted(opts: Parameters<typeof assessed>[0] = {}) {
    const risk = await assessed(opts);
    const res = await submit(risk.id, risk.version);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return dto(res);
  }

  const detail = async (id: string, who: Who) => dto(await h.get(`/api/v1/risks/${id}`, who));

  it("submit is blocked until likelihood, impact, treatment and owner are set and nothing is left to confirm", async () => {
    const risk = await report("rita", { toConfirm: ["Was the laptop encrypted?"] });
    const blocked = await submit(risk.id, 1);
    expect(blocked.status).toBe(409);
    expect(detailPaths(blocked)).toEqual([
      "submitBlocked.missingLikelihood",
      "submitBlocked.missingImpact",
      "submitBlocked.missingTreatment",
      "submitBlocked.missingOwner",
      "submitBlocked.unresolvedToConfirm",
    ]);
    // Only a reviewer submits.
    expect((await submit(risk.id, 1, "april")).status).toBe(403);
    const edited = await h.patch(
      `/api/v1/risks/${risk.id}`,
      {
        expectedVersion: 1,
        changes: {
          likelihood: 2,
          impact: 2,
          treatment: "mitigate",
          ownerId: h.userIds.cora,
          toConfirm: [],
        },
      },
      "cora",
    );
    expect(edited.status).toBe(200);
    expect(detailPaths(await submit(risk.id, 1))).toEqual(["staleVersion"]);
    const res = await submit(risk.id, 2);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(dto(res)).toMatchObject({
      state: "in_review",
      version: 3,
      reviewer: { id: h.userIds.cora, displayName: "Cora Ciso" },
      // Within appetite the reviewer may approve (spec §8.3): april and cora.
      approval: {
        rule: "reviewerMayApprove",
        reviewer: { id: h.userIds.cora },
        eligibleApproverCount: 2,
        noEligibleApprover: false,
        viewerRefusal: null,
        decisions: [],
      },
      can: { edit: false, submit: false, approve: true, return: true },
    });
    const stored = await db.risk.findUniqueOrThrow({ where: { id: risk.id } });
    expect(stored.submittedAt).toBeInstanceOf(Date);
    expect(dto(res).history[0]).toMatchObject({
      version: 3,
      changedFields: ["state", "reviewerId"],
    });
    const [audit] = await audits("risk.submitted");
    expect(audit).toMatchObject({ objectId: risk.id, actorUserId: h.userIds.cora });
    // In review, the risk cannot be edited or submitted again.
    expect(detailPaths(await submit(risk.id, 3))).toEqual(["invalidTransition"]);
  });

  it("the reviewer approves a risk within appetite treated by mitigate, without risks.approve", async () => {
    // cora holds only ciso (risks.review), never risk_approver (spec §8.3).
    expect(
      await db.roleAssignment.count({ where: { userId: h.userIds.cora, role: "risk_approver" } }),
    ).toBe(0);
    const risk = await submitted({ likelihood: 3, impact: 3 });
    expect(risk.approval).toMatchObject({ rule: "reviewerMayApprove", viewerRefusal: null });
    expect(risk.can).toMatchObject({ approve: true, return: true });
    const res = await approve(risk.id, 3, "cora", "Looks right.");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(dto(res)).toMatchObject({ state: "approved", version: 4 });
    expect(dto(res).approval?.decisions).toEqual([
      {
        decision: "approved",
        approver: { id: h.userIds.cora, displayName: "Cora Ciso" },
        comment: "Looks right.",
        version: 3,
        at: expect.any(String) as string,
      },
    ]);
    const stored = await db.risk.findUniqueOrThrow({ where: { id: risk.id } });
    expect(stored.approvedAt).toBeInstanceOf(Date);
    const [audit] = await audits("risk.approved");
    expect(audit).toMatchObject({ objectId: risk.id, actorUserId: h.userIds.cora });
    expect(audit?.afterRef).toMatchObject({
      state: "approved",
      version: 4,
      decidedVersion: 3,
      comment: { length: 12 },
    });
    expect(JSON.stringify(audit?.afterRef)).not.toContain("Looks right.");
    expect(await db.riskVersion.count({ where: { riskId: risk.id } })).toBe(4);
  });

  it("the reviewer cannot approve a risk above appetite: 409 approvalRefused.reviewerNeedsIndependent", async () => {
    await grant("cora", "risk_approver");
    const risk = await submitted({ likelihood: 2, impact: 5 });
    // Only april counts: the reviewer is excluded even holding risks.approve.
    expect(risk.approval).toMatchObject({
      rule: "independentApprover",
      viewerRefusal: "reviewerNeedsIndependent",
      eligibleApproverCount: 1,
    });
    expect(risk.can).toMatchObject({ approve: false, return: true });
    const res = await approve(risk.id, 3, "cora");
    expect(res.status).toBe(409);
    expect(detailPaths(res)).toEqual(["approvalRefused.reviewerNeedsIndependent"]);
    expect(await db.risk.findUniqueOrThrow({ where: { id: risk.id } })).toMatchObject({
      state: "in_review",
      version: 3,
    });
    expect(await db.approval.count()).toBe(0);
  });

  it("the reporter cannot approve their own risk even as risk approver: approvalRefused.reporter", async () => {
    const risk = await submitted({ reporter: "april" });
    const seen = await detail(risk.id, "april");
    expect(seen.approval?.viewerRefusal).toBe("reporter");
    expect(seen.can).toMatchObject({ approve: false, return: false });
    const res = await approve(risk.id, 3, "april");
    expect(res.status).toBe(409);
    expect(detailPaths(res)).toEqual(["approvalRefused.reporter"]);
    const back = await giveBack(risk.id, { expectedVersion: 3, comment: "Mine" }, "april");
    expect(detailPaths(back)).toEqual(["approvalRefused.reporter"]);
  });

  it("an independent risk approver approves a risk treated by accept", async () => {
    const risk = await submitted({ likelihood: 1, impact: 1, treatment: "accept" });
    expect(risk.approval?.rule).toBe("independentApprover");
    // The reviewer is refused; the risk approver, neither reporter nor reviewer, may approve.
    expect(detailPaths(await approve(risk.id, 3, "cora"))).toEqual([
      "approvalRefused.reviewerNeedsIndependent",
    ]);
    // An auditor sees the risk but does not hold risks.approve.
    expect(detailPaths(await approve(risk.id, 3, "aldo"))).toEqual(["approvalRefused.notApprover"]);
    expect((await detail(risk.id, "april")).can).toMatchObject({ approve: true, return: true });
    const res = await approve(risk.id, 3, "april");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(dto(res).state).toBe("approved");
    expect(detailPaths(await approve(risk.id, 4, "april"))).toEqual(["invalidTransition"]);
  });

  it("a site-scoped approver cannot approve a risk at another site, and readiness says no one can", async () => {
    await removeRoles("april", "risk_approver");
    await grant("carl", "risk_approver", "siteA");
    // Above appetite, so the reviewer does not count.
    const atB = await submitted({ site: "siteB", likelihood: 2, impact: 5 });
    expect(atB.approval).toMatchObject({ eligibleApproverCount: 0, noEligibleApprover: true });
    // Outside carl's units the risk does not exist for him.
    expect((await approve(atB.id, 3, "carl")).status).toBe(404);
    const atA = await submitted({ site: "siteA", likelihood: 2, impact: 5 });
    expect(atA.approval).toMatchObject({ eligibleApproverCount: 1, noEligibleApprover: false });
    expect((await approve(atA.id, 3, "carl")).status).toBe(200);
  });

  it("when the only approver is the reporter, readiness reports noEligibleApprover", async () => {
    const risk = await submitted({ reporter: "april", treatment: "accept" });
    expect(risk.approval).toMatchObject({ eligibleApproverCount: 0, noEligibleApprover: true });
    // A second approver makes one eligible.
    await grant("aldo", "risk_approver");
    expect((await detail(risk.id, "cora")).approval).toMatchObject({
      eligibleApproverCount: 1,
      noEligibleApprover: false,
    });
  });

  it("a revoked approver role takes effect at once", async () => {
    await grant("april", "auditor"); // keeps sight of the risk after the revoke
    const risk = await submitted();
    expect((await detail(risk.id, "april")).can.approve).toBe(true);
    const assignment = await db.roleAssignment.findFirstOrThrow({
      where: { userId: h.userIds.april, role: "risk_approver" },
    });
    await h
      .service(RoleAssignmentService)
      .revoke(assignment.id, { actorUserId: h.userIds.admin, requestId: "test-revoke" });
    const res = await approve(risk.id, 3, "april");
    expect(res.status).toBe(409);
    expect(detailPaths(res)).toEqual(["approvalRefused.notApprover"]);
    expect((await detail(risk.id, "april")).approval?.viewerRefusal).toBe("notApprover");
  });

  it("a revoke committed while the approval waits on the risk lock is honoured", async () => {
    await grant("april", "auditor"); // keeps sight of the risk after the revoke
    const risk = await submitted();
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked = (): void => undefined;
    const isLocked = new Promise<void>((resolve) => (locked = resolve));
    // Another transaction holds the risk row, as a concurrent edit would.
    const holder = db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT 1 FROM "Risk" WHERE id = ${risk.id}::uuid FOR UPDATE`;
        locked();
        await held;
      },
      { timeout: 20_000 },
    );
    await isLocked;
    // april authenticates as an approver, then waits on the lock.
    const pending = approve(risk.id, 3, "april");
    for (let i = 0; i < 200; i++) {
      const [row] = await db.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'transactionid' AND NOT granted`;
      if ((row?.n ?? 0) > 0) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    await removeRoles("april", "risk_approver");
    release();
    await holder;
    const res = await pending;
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(detailPaths(res)).toEqual(["approvalRefused.notApprover"]);
    expect(await db.approval.count()).toBe(0);
  });

  it("two concurrent approvals of the same version write exactly one approval", async () => {
    const { id } = await submitted();
    const [a, b] = await Promise.allSettled([approve(id, 3, "april"), approve(id, 3, "april")]);
    expect([a, b].filter((r) => r.status === "fulfilled" && r.value.status === 200)).toHaveLength(
      1,
    );
    expect(await db.approval.count({ where: { riskId: id, decision: "approved" } })).toBe(1);
    expect((await db.risk.findUniqueOrThrow({ where: { id } })).version).toBe(4);
  });

  it("return needs a comment and sends the risk back to returned, editable again", async () => {
    const risk = await submitted();
    expect((await giveBack(risk.id, { expectedVersion: 3 }, "april")).status).toBe(400);
    expect((await giveBack(risk.id, { expectedVersion: 3, comment: "  " }, "april")).status).toBe(
      400,
    );
    // Someone who could not approve it may not return it either.
    expect(
      detailPaths(await giveBack(risk.id, { expectedVersion: 3, comment: "No" }, "aldo")),
    ).toEqual(["approvalRefused.notApprover"]);
    const res = await giveBack(
      risk.id,
      { expectedVersion: 3, comment: "Name the owner's deputy." },
      "april",
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(dto(res)).toMatchObject({ state: "returned", version: 4 });
    expect(dto(res).approval?.decisions).toMatchObject([
      { decision: "returned", comment: "Name the owner's deputy.", version: 3 },
    ]);
    expect((await audits("risk.returned")).map((a) => a.objectId)).toEqual([risk.id]);
    const cora = await detail(risk.id, "cora");
    expect(cora.can).toMatchObject({ edit: true, submit: true, approve: false, return: false });
    const edit = await h.patch(
      `/api/v1/risks/${risk.id}`,
      { expectedVersion: 4, changes: { treatmentNote: "Deputy named." } },
      "cora",
    );
    expect(edit.status).toBe(200);
    // Resubmitted, the reviewer may also withdraw it again without an approver role.
    expect((await submit(risk.id, 5)).status).toBe(200);
    const withdrawn = await giveBack(risk.id, { expectedVersion: 6, comment: "Withdrawn" }, "cora");
    expect(withdrawn.status, JSON.stringify(withdrawn.body)).toBe(200);
    expect(dto(withdrawn).approval?.decisions.map((d) => d.version)).toEqual([3, 6]);
  });

  it("an approval snapshot names the version and the evidence hashes", async () => {
    const risk = await assessed();
    const evidence = await db.evidence.create({
      data: {
        riskId: risk.id,
        objectKey: "evidence/approval",
        fileName: "policy.pdf",
        sha256: "b".repeat(64),
        sizeBytes: 10,
        mimeType: "application/pdf",
        uploadedById: h.userIds.cora,
        collectedAt: new Date(),
      },
    });
    expect((await submit(risk.id, 2)).status).toBe(200);
    expect((await approve(risk.id, 3, "april")).status).toBe(200);
    const approval = await db.approval.findFirstOrThrow({ where: { riskId: risk.id } });
    const version = await db.riskVersion.findFirstOrThrow({
      where: { riskId: risk.id, version: 3 },
    });
    expect(approval).toMatchObject({
      version: 3,
      decision: "approved",
      approverId: h.userIds.april,
    });
    expect(approval.snapshot).toEqual({
      ...(version.snapshot as object),
      version: 3,
      evidence: [{ id: evidence.id, sha256: "b".repeat(64) }],
    });
  });

  it("awaitingMyApproval lists only risks the actor may approve", async () => {
    const within = await submitted({ likelihood: 2, impact: 2 });
    const above = await submitted({ likelihood: 5, impact: 5 });
    const accepted = await submitted({ likelihood: 1, impact: 1, treatment: "accept" });
    const byApril = await submitted({ reporter: "april" });
    const atB = await submitted({ site: "siteB" });
    await assessed(); // proposed, not submitted
    // oscar (risk_owner at site A, no risks.approve) reviews one risk at site A.
    const byOscar = await assessed({ site: "siteA" });
    expect((await submit(byOscar.id, byOscar.version, "oscar")).status).toBe(200);
    const queue = async (who: Who) => {
      const res = await h.get("/api/v1/risks?filter=awaitingMyApproval", who);
      expect(res.status).toBe(200);
      return (res.body as RiskListResponse).items.map((r) => r.id).sort();
    };
    expect(await queue("april")).toEqual(
      [within.id, above.id, accepted.id, atB.id, byOscar.id].sort(),
    );
    // cora reviewed the rest without holding risks.approve: only those within appetite and not
    // accepted are hers to approve (spec §8.3).
    expect(await queue("cora")).toEqual([within.id, byApril.id, atB.id].sort());
    expect(await queue("oscar")).toEqual([byOscar.id]);
    // A site-scoped approver's queue holds only risks at that site.
    await grant("olga", "risk_approver", "siteB");
    expect(await queue("olga")).toEqual([atB.id]);
    expect(await queue("aldo")).toEqual([]);
  });
});
