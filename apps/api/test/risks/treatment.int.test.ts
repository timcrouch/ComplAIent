import type { MyTaskDto, RiskDetailDto, TreatmentActionDto } from "@isms/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Who, audits, db, detailPaths, reportBody, risksHarness } from "./harness.js";

const DAY_MS = 24 * 3600 * 1000;
const isoDay = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * DAY_MS).toISOString().slice(0, 10);

describe("treatment actions", () => {
  const h = risksHarness();
  let controlId = "";
  beforeAll(() => h.start());
  beforeEach(async () => {
    await h.reset();
    await db.riskScale.create({
      data: { version: 1, appetiteThreshold: 9, createdById: h.userIds.admin },
    });
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
  });
  afterAll(() => h.stop());

  const dto = (res: { body: unknown }) => res.body as RiskDetailDto;

  /** A risk reported by Rita, then set directly to an approved mitigate risk owned by Cora. */
  async function risk(
    fields: {
      state?: "approved" | "closed";
      treatment?: "mitigate" | "accept";
    } = {},
  ) {
    const res = await h.post("/api/v1/risks", reportBody(), "rita");
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = dto(res).id;
    await db.risk.update({
      where: { id },
      data: {
        state: fields.state ?? "approved",
        treatment: fields.treatment ?? "mitigate",
        likelihood: 3,
        impact: 3,
        ownerId: h.userIds.cora,
        reviewerId: h.userIds.cora,
        ...(fields.state === "closed" ? { closedAt: new Date() } : {}),
      },
    });
    return id;
  }
  const actionBody = (assignee: Who = "carl", over: Record<string, unknown> = {}) => ({
    title: "Encrypt the laptops",
    description: "Turn on disk encryption.",
    assigneeId: h.userIds[assignee],
    dueDate: isoDay(7),
    controlId: null,
    ...over,
  });
  const add = (riskId: string, body: Record<string, unknown>, who: Who = "cora") =>
    h.post(`/api/v1/risks/${riskId}/actions`, body, who);
  const addOk = async (riskId: string, over: Record<string, unknown> = {}) => {
    const res = await add(riskId, actionBody("carl", over));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as TreatmentActionDto;
  };
  const complete = (taskId: string, who: Who, note = "Done it") =>
    h.post(`/api/v1/tasks/${taskId}/complete`, { note }, who);
  const cancel = (taskId: string, who: Who, reason = "No longer needed") =>
    h.post(`/api/v1/tasks/${taskId}/cancel`, { reason }, who);

  describe("adding an action", () => {
    it("refuses a past due date (400 at dueDate) and accepts today (UTC)", async () => {
      const id = await risk();
      const past = await add(id, actionBody("carl", { dueDate: isoDay(-1) }));
      expect(past.status, JSON.stringify(past.body)).toBe(400);
      expect(detailPaths(past)).toEqual(["dueDate"]);
      expect(await db.task.count({ where: { riskId: id } })).toBe(0);
      expect((await add(id, actionBody("carl", { dueDate: isoDay(0) }))).status).toBe(201);
    });

    it("creates it on an approved mitigate risk and lists it in the treatment plan", async () => {
      const id = await risk();
      const res = await add(id, actionBody());
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const action = res.body as TreatmentActionDto;
      expect(action).toMatchObject({
        title: "Encrypt the laptops",
        description: "Turn on disk encryption.",
        assignee: { id: h.userIds.carl, displayName: "Carl Contributor" },
        dueDate: isoDay(7),
        status: "open",
        overdue: false,
        control: null,
        completedAt: null,
        completedBy: null,
        completionNote: "",
        cancelledReason: "",
      });
      const seen = dto(await h.get(`/api/v1/risks/${id}`, "cora"));
      expect(seen.treatmentPlan).toMatchObject({ open: 1, done: 0, overdue: 0 });
      expect(seen.treatmentPlan.actions.map((a) => a.id)).toEqual([action.id]);
      expect(seen.can.planActions).toBe(true);
      const [event] = await audits("task.created");
      expect(event?.afterRef).toMatchObject({ kind: "treatment_action", riskId: id });
    });

    it("names an accepted control when given, and refuses one that is not accepted", async () => {
      const id = await risk();
      const refused = await add(id, actionBody("carl", { controlId }));
      expect(refused.status).toBe(409);
      expect(detailPaths(refused)).toEqual(["controlNotAccepted"]);
      await db.riskControl.create({
        data: { riskId: id, controlId, status: "accepted", source: "person" },
      });
      const action = await addOk(id, { controlId });
      expect(action.control).toEqual({ code: "AST-01", title: "Asset inventory" });
    });

    it("refuses an accept risk and a closed risk", async () => {
      const accept = await add(await risk({ treatment: "accept" }), actionBody());
      expect(accept.status).toBe(409);
      expect(detailPaths(accept)).toEqual(["treatmentIsAccept"]);
      const closed = await add(await risk({ state: "closed" }), actionBody());
      expect(closed.status).toBe(409);
      expect(detailPaths(closed)).toEqual(["riskClosed"]);
    });

    it("refuses an unknown assignee at assigneeId, a non-reviewer, and a risk the caller cannot see", async () => {
      const id = await risk();
      const unknown = await add(id, actionBody("carl", { assigneeId: crypto.randomUUID() }));
      expect(unknown.status).toBe(400);
      expect(detailPaths(unknown)).toContain("assigneeId");
      // Rita reported it, so she sees it but may not plan actions.
      expect((await add(id, actionBody(), "rita")).status).toBe(403);
      // Oscar reviews at site A only; this risk belongs to no site.
      expect((await add(id, actionBody(), "oscar")).status).toBe(404);
      expect(await db.task.count()).toBe(0);
    });

    it("shows can.planActions only to a reviewer of a risk that may take actions", async () => {
      const mitigate = await risk();
      const accept = await risk({ treatment: "accept" });
      expect(dto(await h.get(`/api/v1/risks/${mitigate}`, "vera")).can.planActions).toBe(false);
      expect(dto(await h.get(`/api/v1/risks/${accept}`, "cora")).can.planActions).toBe(false);
    });
  });

  describe("completing an action", () => {
    it("lets the assignee complete it without seeing the risk", async () => {
      const id = await risk();
      const action = await addOk(id);
      // A contributor never reads the risk record (no risks.read).
      expect((await h.get(`/api/v1/risks/${id}`, "carl")).status).toBe(403);
      const res = await complete(action.id, "carl", "Encrypted all of them");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body as MyTaskDto).toMatchObject({
        id: action.id,
        status: "done",
        kind: "treatment_action",
        control: null,
      });
      const stored = await db.task.findUniqueOrThrow({ where: { id: action.id } });
      expect(stored).toMatchObject({
        status: "done",
        completedById: h.userIds.carl,
        completionNote: "Encrypted all of them",
      });
      expect(stored.completedAt).toBeInstanceOf(Date);
      expect(await audits("task.completed")).toHaveLength(1);
      expect((await h.get(`/api/v1/risks/${id}`, "carl")).status).toBe(403);
      const plan = dto(await h.get(`/api/v1/risks/${id}`, "cora")).treatmentPlan;
      expect(plan).toMatchObject({ open: 0, done: 1 });
      expect(plan.actions[0]).toMatchObject({
        status: "done",
        completedBy: { id: h.userIds.carl },
        completionNote: "Encrypted all of them",
      });
    });

    it("lets a reviewer complete it, and answers 404 to someone who cannot see the task", async () => {
      const action = await addOk(await risk());
      expect((await complete(action.id, "sam")).status).toBe(404);
      expect((await complete(action.id, "vera")).status).toBe(404);
      expect((await complete(action.id, "cora")).status).toBe(200);
    });

    it("refuses a task that is no longer open", async () => {
      const action = await addOk(await risk());
      expect((await complete(action.id, "carl")).status).toBe(200);
      const again = await complete(action.id, "carl");
      expect(again.status).toBe(409);
      expect(detailPaths(again)).toEqual(["taskClosed"]);
    });

    it("refuses an evidence request, which completes by upload", async () => {
      const id = await risk();
      await db.riskControl.create({
        data: { riskId: id, controlId, status: "accepted", source: "person" },
      });
      const request = await db.task.create({
        data: {
          kind: "evidence_request",
          title: "Upload",
          assigneeId: h.userIds.carl,
          requestedById: h.userIds.cora,
          riskId: id,
          controlId,
        },
      });
      const res = await complete(request.id, "carl");
      expect(res.status).toBe(409);
      expect(detailPaths(res)).toEqual(["invalidTransition"]);
    });

    it("refuses a periodic review task, which completes by confirming the review", async () => {
      const id = await risk();
      const review = await db.task.create({
        data: {
          kind: "periodic_review",
          title: "ignored",
          assigneeId: h.userIds.carl,
          requestedById: h.userIds.cora,
          riskId: id,
        },
      });
      const res = await complete(review.id, "carl", "Still accurate");
      expect(res.status).toBe(409);
      expect(detailPaths(res)).toEqual(["invalidTransition"]);
      expect((await db.task.findUniqueOrThrow({ where: { id: review.id } })).status).toBe("open");
    });

    it("lets the close succeed once every action is done (end to end)", async () => {
      const id = await risk();
      const action = await addOk(id);
      const version = dto(await h.get(`/api/v1/risks/${id}`, "cora")).version;
      const blocked = await h.post(
        `/api/v1/risks/${id}/close`,
        { expectedVersion: version, note: "Treated" },
        "cora",
      );
      expect(blocked.status).toBe(409);
      expect(detailPaths(blocked)).toEqual(["openTreatmentActions"]);
      await complete(action.id, "carl");
      const closed = await h.post(
        `/api/v1/risks/${id}/close`,
        { expectedVersion: version, note: "Treated" },
        "cora",
      );
      expect(closed.status, JSON.stringify(closed.body)).toBe(200);
      expect(dto(closed).state).toBe("closed");
    });
  });

  describe("cancelling an action", () => {
    it("lets a reviewer cancel it with a reason", async () => {
      const id = await risk();
      const action = await addOk(id);
      const res = await cancel(action.id, "cora", "Superseded");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body as TreatmentActionDto).toMatchObject({
        status: "cancelled",
        cancelledReason: "Superseded",
      });
      const stored = await db.task.findUniqueOrThrow({ where: { id: action.id } });
      expect(stored.cancelledById).toBe(h.userIds.cora);
      expect(await audits("task.cancelled")).toHaveLength(1);
      expect(dto(await h.get(`/api/v1/risks/${id}`, "cora")).treatmentPlan).toMatchObject({
        open: 0,
        done: 0,
      });
      const again = await cancel(action.id, "cora");
      expect(again.status).toBe(409);
      expect(detailPaths(again)).toEqual(["taskClosed"]);
    });

    it("refuses the assignee (403), hides it from others (404), and cancels only treatment actions", async () => {
      const id = await risk();
      const action = await addOk(id);
      expect((await cancel(action.id, "carl")).status).toBe(403);
      expect((await cancel(action.id, "oscar")).status).toBe(404);
      const review = await db.task.create({
        data: {
          kind: "periodic_review",
          title: "x",
          assigneeId: h.userIds.carl,
          requestedById: h.userIds.cora,
          riskId: id,
        },
      });
      const res = await cancel(review.id, "cora");
      expect(res.status).toBe(409);
      expect(detailPaths(res)).toEqual(["invalidTransition"]);
    });
  });

  it("counts overdue actions in the plan and marks them", async () => {
    const id = await risk();
    // An action cannot be added with a past due date; it becomes overdue as time passes.
    const late = await addOk(id, { dueDate: isoDay(0) });
    await db.task.update({ where: { id: late.id }, data: { dueDate: new Date(isoDay(-2)) } });
    await addOk(id, { dueDate: isoDay(5) });
    const plan = dto(await h.get(`/api/v1/risks/${id}`, "cora")).treatmentPlan;
    expect(plan).toMatchObject({ open: 2, done: 0, overdue: 1 });
    // Open first by due date.
    expect(plan.actions[0]).toMatchObject({ id: late.id, overdue: true });
  });

  it("lists done and cancelled actions after the open ones, newest first", async () => {
    const id = await risk();
    const first = await addOk(id, { title: "First" });
    const second = await addOk(id, { title: "Second" });
    await addOk(id, { title: "Third", dueDate: isoDay(30) });
    await complete(first.id, "carl");
    await new Promise((r) => setTimeout(r, 5));
    await cancel(second.id, "cora");
    const titles = dto(await h.get(`/api/v1/risks/${id}`, "cora")).treatmentPlan.actions.map(
      (a) => a.title,
    );
    expect(titles).toEqual(["Third", "Second", "First"]);
  });
});
