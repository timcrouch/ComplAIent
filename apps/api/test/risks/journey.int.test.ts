import type { RiskDetailDto } from "@isms/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Who, db, reportBody, risksHarness } from "./harness.js";

describe("the journey in the risk detail", () => {
  const h = risksHarness();
  beforeAll(() => h.start());
  beforeEach(async () => {
    await h.reset();
    await db.riskScale.create({
      data: { version: 1, appetiteThreshold: 9, createdById: h.userIds.admin },
    });
  });
  afterAll(() => h.stop());

  const dto = (res: { body: unknown }) => res.body as RiskDetailDto;
  const path = (id: string, action: string) => `/api/v1/risks/${id}/${action}`;
  const statuses = (r: RiskDetailDto) => r.journey.steps.map((s) => s.status);

  /** A risk reported by rita and assessed by cora (version 2). */
  async function assessed(likelihood = 3, impact = 3, treatment = "mitigate") {
    const created = await h.post("/api/v1/risks", reportBody(), "rita");
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = dto(created).id;
    const res = await h.patch(
      `/api/v1/risks/${id}`,
      {
        expectedVersion: 1,
        changes: { likelihood, impact, treatment, ownerId: h.userIds.cora },
      },
      "cora",
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return dto(res);
  }
  const submit = (id: string, expectedVersion: number, who: Who = "cora") =>
    h.post(path(id, "submit"), { expectedVersion }, who);
  const giveBack = (id: string, expectedVersion: number, comment: string, who: Who = "april") =>
    h.post(path(id, "return"), { expectedVersion, comment }, who);

  it("a new risk is reported, waits on its owner", async () => {
    const created = await h.post("/api/v1/risks", reportBody(), "rita");
    const risk = dto(created);
    expect(statuses(risk)).toEqual(["done", "current", "upcoming", "upcoming", "upcoming"]);
    expect(risk.journey.steps.map((s) => s.key)).toEqual([
      "reported",
      "under_review",
      "awaiting_approval",
      "approved",
      "closed",
    ]);
    expect(risk.journey.steps[0]?.by).toEqual({ id: h.userIds.rita, displayName: "Rita Reporter" });
    expect(risk.journey.steps[3]).toMatchObject({ at: null, by: null });
    expect(risk.journey.waitingOn.kind).toBe("owner");
    expect(risk.journey).toMatchObject({ returnCount: 0, returns: [] });
    expect(typeof risk.journey.since).toBe("string");
  });

  it("after submit it waits for approval, naming the eligible approvers", async () => {
    const risk = await assessed();
    const res = await submit(risk.id, 2);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const j = dto(res).journey;
    expect(statuses(dto(res))).toEqual(["done", "done", "current", "upcoming", "upcoming"]);
    expect(j.steps[2]?.by?.id).toBe(h.userIds.cora);
    expect(j.waitingOn).toMatchObject({
      kind: "approver",
      rule: "reviewerMayApprove",
      reviewer: { id: h.userIds.cora },
      eligibleApproverCount: 2,
      noEligibleApprover: false,
      eligibleApprovers: [
        { id: h.userIds.april, displayName: "April Approver" },
        { id: h.userIds.cora, displayName: "Cora Ciso" },
      ],
    });
  });

  it("names the approvers only to people who review or approve at the risk's scope", async () => {
    const risk = await assessed();
    expect((await submit(risk.id, 2)).status).toBe(200);
    // A contributor cannot read risks, so rita (the reporter) also holds the viewer role.
    await db.roleAssignment.create({
      data: {
        userId: h.userIds.rita,
        role: "viewer",
        scopeType: "ORGANISATION",
        grantedById: h.userIds.admin,
      },
    });
    const approver = async (who: Who) => {
      const res = await h.get(`/api/v1/risks/${risk.id}`, who);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const w = dto(res).journey.waitingOn;
      if (w.kind !== "approver") throw new Error("expected approver");
      return w;
    };
    // rita reported it (a contributor with read access only) and aldo is an auditor: the count, never the names.
    for (const who of ["rita", "aldo"] as const) {
      expect(await approver(who)).toMatchObject({
        eligibleApprovers: [],
        eligibleApproverCount: 2,
        noEligibleApprover: false,
      });
    }
    const named = await approver("april");
    expect(named.eligibleApprovers.map((p) => p.displayName)).toEqual([
      "April Approver",
      "Cora Ciso",
    ]);
    expect((await approver("cora")).eligibleApprovers).toHaveLength(2);
  });

  it("counts returns, lists them oldest first, and ends approved by the approver", async () => {
    const risk = await assessed();
    expect((await submit(risk.id, 2)).status).toBe(200);
    expect((await giveBack(risk.id, 3, "First fix")).status).toBe(200);
    const mid = dto(await h.get(`/api/v1/risks/${risk.id}`, "cora"));
    expect(statuses(mid)).toEqual(["done", "current", "upcoming", "upcoming", "upcoming"]);
    expect(mid.journey.waitingOn.kind).toBe("owner");
    expect((await submit(risk.id, 4)).status).toBe(200);
    expect((await giveBack(risk.id, 5, "Second fix")).status).toBe(200);
    expect((await submit(risk.id, 6)).status).toBe(200);
    const res = await h.post(path(risk.id, "approve"), { expectedVersion: 7 }, "april");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const j = dto(res).journey;
    expect(statuses(dto(res))).toEqual(["done", "done", "done", "current", "upcoming"]);
    expect(j.steps[3]?.by).toEqual({ id: h.userIds.april, displayName: "April Approver" });
    expect(j.waitingOn).toMatchObject({ kind: "review" });
    expect(j.returnCount).toBe(2);
    expect(j.returns.map((r) => [r.comment, r.by.id])).toEqual([
      ["First fix", h.userIds.april],
      ["Second fix", h.userIds.april],
    ]);
  });

  it("lists only the returns of the current cycle after a reassess", async () => {
    const risk = await assessed();
    expect((await submit(risk.id, 2)).status).toBe(200);
    expect((await giveBack(risk.id, 3, "Old cycle")).status).toBe(200);
    expect((await submit(risk.id, 4)).status).toBe(200);
    expect((await h.post(path(risk.id, "approve"), { expectedVersion: 5 }, "april")).status).toBe(
      200,
    );
    const reassessed = await h.post(
      path(risk.id, "reassess"),
      { expectedVersion: 6, reason: "Things changed" },
      "cora",
    );
    expect(reassessed.status, JSON.stringify(reassessed.body)).toBe(200);
    expect(dto(reassessed).journey).toMatchObject({ returnCount: 0, returns: [] });
    expect((await submit(risk.id, 7)).status).toBe(200);
    expect((await giveBack(risk.id, 8, "New cycle")).status).toBe(200);
    expect((await submit(risk.id, 9)).status).toBe(200);
    const res = await h.post(path(risk.id, "approve"), { expectedVersion: 10 }, "april");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const j = dto(res).journey;
    expect(j.cycle).toBe("reassessed");
    expect(j.returnCount).toBe(1);
    expect(j.returns.map((r) => r.comment)).toEqual(["New cycle"]);
  });

  it("reports noEligibleApprover with no approvers listed", async () => {
    await db.roleAssignment.deleteMany({ where: { role: "risk_approver" } });
    const risk = await assessed(2, 5);
    const res = await submit(risk.id, 2);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(dto(res).journey.waitingOn).toMatchObject({
      kind: "approver",
      noEligibleApprover: true,
      eligibleApproverCount: 0,
      eligibleApprovers: [],
    });
  });

  it("limits the named approvers to five, ordered by name", async () => {
    const risk = await assessed(2, 5);
    for (let i = 0; i < 6; i++) {
      const user = await db.user.create({
        data: {
          email: `extra${String(i)}@example.test`,
          displayName: `Extra ${String.fromCharCode(65 + i)}`,
          idpIssuer: "https://extra.example.test",
          idpSubject: `extra-${String(i)}`,
        },
      });
      await db.roleAssignment.create({
        data: {
          userId: user.id,
          role: "risk_approver",
          scopeType: "ORGANISATION",
          grantedById: h.userIds.admin,
        },
      });
    }
    const res = await submit(risk.id, 2);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const w = dto(res).journey.waitingOn;
    if (w.kind !== "approver") throw new Error("expected approver");
    expect(w.eligibleApproverCount).toBe(7);
    expect(w.eligibleApprovers.map((p) => p.displayName)).toEqual([
      "April Approver",
      "Extra A",
      "Extra B",
      "Extra C",
      "Extra D",
    ]);
  });

  it("a viewer cannot read the journey of a risk they cannot see", async () => {
    const risk = await assessed();
    expect((await h.get(`/api/v1/risks/${risk.id}`, "vera")).status).toBe(404);
  });
});
