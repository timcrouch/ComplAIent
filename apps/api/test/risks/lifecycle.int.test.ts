import type { RiskDetailDto } from "@isms/contracts";
import { reviewDueDate } from "@isms/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Who, audits, db, detailPaths, reportBody, risksHarness } from "./harness.js";

describe("risk lifecycle: close, reassess, confirm review", () => {
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
  const today = () => reviewDueDate(new Date(), 0);
  const inAYear = () => reviewDueDate(new Date(), 12);

  /** A complete risk, assessed and submitted by cora (version 3), in review. */
  async function inReview(treatment = "mitigate") {
    const created = await h.post("/api/v1/risks", reportBody(), "rita");
    const edited = await h.patch(
      `/api/v1/risks/${dto(created).id}`,
      {
        expectedVersion: 1,
        changes: { likelihood: 3, impact: 3, treatment, ownerId: h.userIds.cora },
      },
      "cora",
    );
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    const res = await h.post(path(dto(edited).id, "submit"), { expectedVersion: 2 }, "cora");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return dto(res);
  }
  const approveRisk = async (risk: RiskDetailDto) => {
    const res = await h.post(path(risk.id, "approve"), { expectedVersion: risk.version }, "april");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return dto(res);
  };
  const approved = async () => approveRisk(await inReview());
  const close = (id: string, expectedVersion: number, who: Who = "cora", note = "All done") =>
    h.post(path(id, "close"), { expectedVersion, note }, who);
  const reassess = (id: string, expectedVersion: number, who: Who = "cora") =>
    h.post(path(id, "reassess"), { expectedVersion, reason: "Things changed" }, who);
  const confirm = (id: string, expectedVersion: number, who: Who = "cora", note = "Still fine") =>
    h.post(path(id, "review-confirmation"), { expectedVersion, note }, who);

  const addTask = (
    riskId: string,
    kind: "treatment_action" | "periodic_review",
    status: "open" | "done" = "open",
  ) =>
    db.task.create({
      data: {
        kind,
        title: kind === "periodic_review" ? "Review this risk" : "Do the thing",
        assigneeId: h.userIds.cora,
        requestedById: h.userIds.cora,
        status,
        riskId,
      },
    });

  it("approving sets nextReviewDue and completes an open periodic review task", async () => {
    const risk = await inReview();
    const task = await addTask(risk.id, "periodic_review");
    const res = await approveRisk(risk);
    expect(res.nextReviewDue).toBe(inAYear());
    expect(res.history[0]?.changedFields).toContain("nextReviewDue");
    const stored = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(stored).toMatchObject({
      status: "done",
      completedById: h.userIds.april,
      completionNote: "",
    });
    expect(stored.completedAt).toBeInstanceOf(Date);
    expect(await audits("task.completed")).toHaveLength(1);
  });

  it("closes an approved risk with no actions", async () => {
    const risk = await approved();
    const seen = dto(await h.get(`/api/v1/risks/${risk.id}`, "cora"));
    expect(seen.can).toMatchObject({ close: true, reassess: true, confirmReview: true });
    expect(risk.can).toMatchObject({ close: false, reassess: false, confirmReview: false });
    const res = await close(risk.id, risk.version);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(dto(res)).toMatchObject({
      state: "closed",
      version: risk.version + 1,
      nextReviewDue: inAYear(),
      reviewDue: false,
      closedBy: { id: h.userIds.cora },
      can: { close: false, reassess: true, confirmReview: true, edit: false },
    });
    expect(dto(res).closedAt).not.toBeNull();
    const [version] = await db.riskVersion.findMany({
      where: { riskId: risk.id, version: risk.version + 1 },
    });
    expect(version?.changedFields).toEqual(["state", "closedAt", "closedById", "nextReviewDue"]);
    expect((version?.snapshot as { lifecycleNote?: string }).lifecycleNote).toBe("All done");
    const [audit] = await audits("risk.closed");
    expect(audit).toMatchObject({ objectId: risk.id, actorUserId: h.userIds.cora });
    expect(JSON.stringify(audit)).not.toContain("All done");
    expect(dto(res).journey.steps.at(-1)).toMatchObject({ key: "closed", status: "current" });
    expect(dto(res).journey.waitingOn).toEqual({ kind: "review", nextReviewDue: inAYear() });
  });

  it("reviewDue is decided by the API: approved or closed with the date today or earlier (UTC)", async () => {
    const risk = await approved();
    const read = async () => dto(await h.get(`/api/v1/risks/${risk.id}`, "cora"));
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
    const setDue = (iso: string) =>
      db.risk.update({ where: { id: risk.id }, data: { nextReviewDue: new Date(iso) } });
    await setDue(tomorrow);
    expect((await read()).reviewDue).toBe(false);
    await setDue(today);
    expect((await read()).reviewDue).toBe(true);
    await db.risk.update({ where: { id: risk.id }, data: { state: "closed" } });
    expect((await read()).reviewDue).toBe(true);
    await db.risk.update({ where: { id: risk.id }, data: { state: "proposed" } });
    expect((await read()).reviewDue).toBe(false);
  });

  it("closing completes an open periodic review task", async () => {
    const risk = await approved();
    const task = await addTask(risk.id, "periodic_review");
    const res = await close(risk.id, risk.version);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await db.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({
      status: "done",
      completedById: h.userIds.cora,
      completionNote: "All done",
    });
    expect(await audits("task.completed")).toHaveLength(1);
  });

  it("refuses to close while a treatment action is open, and can.close says so", async () => {
    const risk = await approved();
    await addTask(risk.id, "treatment_action");
    expect((await h.get(`/api/v1/risks/${risk.id}`, "cora")).body).toMatchObject({
      can: { close: false },
    });
    const res = await close(risk.id, risk.version);
    expect(res.status).toBe(409);
    expect(detailPaths(res)).toEqual(["openTreatmentActions"]);
  });

  it("closes once the actions are done", async () => {
    const risk = await approved();
    await addTask(risk.id, "treatment_action", "done");
    expect((await close(risk.id, risk.version)).status).toBe(200);
  });

  it("refuses close on a proposed risk and confirmReview on a proposed risk", async () => {
    const created = dto(await h.post("/api/v1/risks", reportBody(), "rita"));
    const res = await close(created.id, 1);
    expect(res.status).toBe(409);
    expect(detailPaths(res)).toEqual(["invalidTransition"]);
    const res2 = await confirm(created.id, 1);
    expect(res2.status).toBe(409);
    expect(detailPaths(res2)).toEqual(["invalidTransition"]);
  });

  it("only a reviewer may act; a viewer gets 403", async () => {
    const risk = await approved();
    expect((await close(risk.id, risk.version, "vera")).status).toBe(403);
    expect((await reassess(risk.id, risk.version, "vera")).status).toBe(403);
    expect((await confirm(risk.id, risk.version, "vera")).status).toBe(403);
  });

  it("a stale version is a 409 staleVersion", async () => {
    const risk = await approved();
    for (const res of [
      await close(risk.id, risk.version - 1),
      await reassess(risk.id, risk.version - 1),
      await confirm(risk.id, risk.version - 1),
    ]) {
      expect(res.status).toBe(409);
      expect(detailPaths(res)).toEqual(["staleVersion"]);
    }
  });

  it("reassesses a closed risk, then submit and approve start a second cycle", async () => {
    const risk = await approved();
    const closed = dto(await close(risk.id, risk.version));
    const res = await reassess(risk.id, closed.version);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(dto(res)).toMatchObject({
      state: "proposed",
      nextReviewDue: null,
      closedAt: null,
      closedBy: null,
      reviewer: null,
      can: { edit: true, close: false, reassess: false, confirmReview: false },
    });
    expect(dto(res).journey.cycle).toBe("reassessed");
    const [audit] = await audits("risk.reassessed");
    expect(audit?.objectId).toBe(risk.id);
    const version = await db.riskVersion.findFirstOrThrow({
      where: { riskId: risk.id, version: dto(res).version },
    });
    expect(version.changedFields).toEqual([
      "state",
      "nextReviewDue",
      "closedAt",
      "closedById",
      "reviewerId",
      "submittedAt",
    ]);
    const submitted = await h.post(
      path(risk.id, "submit"),
      { expectedVersion: dto(res).version },
      "cora",
    );
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    const again = await approveRisk(dto(submitted));
    expect(again.nextReviewDue).toBe(inAYear());
    expect(again.journey.cycle).toBe("reassessed");
    expect(again.journey.waitingOn).toEqual({ kind: "review", nextReviewDue: inAYear() });
  });

  it("reassess keeps open treatment actions open", async () => {
    const risk = await approved();
    const task = await addTask(risk.id, "treatment_action");
    expect((await reassess(risk.id, risk.version)).status).toBe(200);
    expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("open");
  });

  it("confirms a review: the task is done and nextReviewDue moves on", async () => {
    const risk = await approved();
    const task = await addTask(risk.id, "periodic_review");
    await db.risk.update({ where: { id: risk.id }, data: { nextReviewDue: new Date(today()) } });
    const res = await confirm(risk.id, risk.version, "cora", "Checked, nothing changed");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(dto(res)).toMatchObject({
      state: "approved",
      nextReviewDue: inAYear(),
      version: risk.version + 1,
    });
    const stored = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(stored).toMatchObject({
      status: "done",
      completedById: h.userIds.cora,
      completionNote: "Checked, nothing changed",
    });
    const version = await db.riskVersion.findFirstOrThrow({
      where: { riskId: risk.id, version: risk.version + 1 },
    });
    expect(version.changedFields).toEqual(["nextReviewDue"]);
    expect(await audits("risk.review_confirmed")).toHaveLength(1);
  });
});
