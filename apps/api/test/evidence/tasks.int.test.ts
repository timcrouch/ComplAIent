import { randomBytes } from "node:crypto";
import type { EvidenceDto, MyTaskDto, MyTasksResponse, RiskDetailDto } from "@isms/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { audits, db, detailPaths } from "../risks/harness.js";
import { evidenceHarness, objectKeys } from "./harness.js";

const h = evidenceHarness();
beforeAll(() => h.start());
beforeEach(() => h.reset());
afterAll(() => h.stop());

const pdf = () => Buffer.concat([Buffer.from("%PDF-1.4\n"), randomBytes(512)]);
const tasks = (res: { body: unknown }) => (res.body as MyTasksResponse).items;

const requestBody = (assigneeId: string, controlId: string, overrides = {}) => ({
  assigneeId,
  controlId,
  title: "Send the last restore test report",
  description: "The report from the quarterly restore test.\nA PDF is fine.",
  dueDate: "2026-12-01",
  ...overrides,
});

async function requestEvidence(riskId: string, controlId: string, overrides = {}) {
  const res = await h.post(
    `/api/v1/risks/${riskId}/evidence-requests`,
    requestBody(h.userIds.carl, controlId, overrides),
    "cora",
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as MyTaskDto;
}

describe("evidence requests as tasks", () => {
  it("lists every task kind for the assignee, naming a review task from its risk", async () => {
    const { riskId, ctl } = await h.riskWithAcceptedControl();
    await requestEvidence(riskId, ctl);
    await db.task.create({
      data: {
        kind: "periodic_review",
        title: "stored title",
        assigneeId: h.userIds.carl,
        requestedById: h.userIds.cora,
        riskId,
      },
    });
    const items = tasks(await h.get("/api/v1/me/tasks", "carl"));
    expect(items.map((t) => t.kind).sort()).toEqual(["evidence_request", "periodic_review"]);
    const review = items.find((t) => t.kind === "periodic_review");
    // No English label is built server-side: the client names a review from the risk fields.
    expect(review).toMatchObject({
      title: "stored title",
      riskReference: "R-0001",
      riskTitle: expect.any(String) as string,
      completionNote: "",
    });
    expect(review?.riskTitle).not.toBe("");
    expect(review?.control).toBeNull();
    // Carl (a contributor) cannot open the risk, so neither task links to it.
    expect(items.map((t) => t.riskId)).toEqual([null, null]);
    expect(items.find((t) => t.kind === "evidence_request")?.riskTitle).toBeNull();
  });

  it("links a task to its risk only for an assignee who may see the risk", async () => {
    const { riskId } = await h.riskWithAcceptedControl();
    for (const who of ["oscar", "olga"] as const)
      await db.task.create({
        data: {
          kind: "treatment_action",
          title: "Encrypt the laptops",
          assigneeId: h.userIds[who],
          requestedById: h.userIds.cora,
          riskId,
        },
      });
    // Oscar owns site A (the risk's site); Olga owns site B.
    const [oscar] = tasks(await h.get("/api/v1/me/tasks", "oscar"));
    expect(oscar).toMatchObject({ riskId, riskReference: "R-0001" });
    expect(oscar?.riskTitle).toEqual(expect.any(String));
    const [olga] = tasks(await h.get("/api/v1/me/tasks", "olga"));
    expect(olga).toMatchObject({ riskId: null, riskReference: "R-0001" });
    expect(olga?.riskTitle).toBe(oscar?.riskTitle);
  });

  it("an evidence request creates a task the contributor sees without the risk record", async () => {
    const { riskId, ctl } = await h.riskWithAcceptedControl();
    const task = await requestEvidence(riskId, ctl);
    // The requester (cora) may open the risk; the assignee (carl) may not.
    expect(task.riskId).toBe(riskId);
    expect(tasks(await h.get("/api/v1/me/tasks", "carl"))).toEqual([{ ...task, riskId: null }]);
    expect({ ...task, riskId: null }).toEqual({
      id: task.id,
      kind: "evidence_request",
      title: "Send the last restore test report",
      description: "The report from the quarterly restore test.\nA PDF is fine.",
      dueDate: "2026-12-01",
      status: "open",
      overdue: false,
      control: { code: "CTL-01", title: "Backups are tested" },
      riskReference: "R-0001",
      riskTitle: null,
      riskId: null,
      completionNote: "",
    });
    const [audit] = await audits("task.created");
    expect(audit?.objectType).toBe("Task");
    expect(audit?.objectId).toBe(task.id);
    expect(audit?.afterRef).toMatchObject({ riskId, controlCode: "CTL-01" });

    // Carl gets the task, never the risk; others do not see Carl's task.
    expect((await h.get(`/api/v1/risks/${riskId}`, "carl")).status).toBe(403);
    expect(tasks(await h.get("/api/v1/me/tasks", "sam"))).toEqual([]);
  });

  it("refuses a control that is not accepted, an unknown assignee and reviewers out of scope", async () => {
    const { riskId, ctl, suggestedCtl } = await h.riskWithAcceptedControl();
    const path = `/api/v1/risks/${riskId}/evidence-requests`;
    const notAccepted = await h.post(path, requestBody(h.userIds.carl, suggestedCtl), "cora");
    expect(notAccepted.status).toBe(409);
    expect(detailPaths(notAccepted)).toEqual(["controlNotAccepted"]);
    const unknown = await h.post(
      path,
      requestBody("00000000-0000-7000-8000-000000000000", ctl),
      "cora",
    );
    expect(unknown.status).toBe(400);
    expect(detailPaths(unknown)).toEqual(["assigneeId"]);
    expect((await h.post(path, requestBody(h.userIds.carl, ctl), "olga")).status).toBe(404);
    expect((await h.post(path, requestBody(h.userIds.carl, ctl), "carl")).status).toBe(403);
    expect(await db.task.count()).toBe(0);
  });

  it("a control with an open evidence request cannot be removed: 409 controlHasOpenRequest", async () => {
    const { riskId, ctl } = await h.riskWithAcceptedControl();
    const task = await requestEvidence(riskId, ctl);
    const rc = await db.riskControl.findFirstOrThrow({ where: { riskId, controlId: ctl } });
    const remove = () =>
      h.delete(`/api/v1/risks/${riskId}/controls/${rc.id}`, { expectedVersion: 1 }, "cora");
    const blocked = await remove();
    expect(blocked.status).toBe(409);
    expect(detailPaths(blocked)).toEqual(["controlHasOpenRequest"]);
    expect(await db.riskControl.count({ where: { id: rc.id } })).toBe(1);
    expect(await audits("risk.control_removed")).toHaveLength(0);
    // Once the request is no longer open, the control can go.
    await db.task.update({ where: { id: task.id }, data: { status: "cancelled" } });
    const ok = await remove();
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it("an evidence request waits for a control removal holding the risk, then is refused", async () => {
    const { riskId, ctl } = await h.riskWithAcceptedControl();
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked = (): void => undefined;
    const isLocked = new Promise<void>((resolve) => (locked = resolve));
    // Stands in for RiskControlsService.remove: it holds the risk row and deletes the control.
    const removal = db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT 1 FROM "Risk" WHERE id = ${riskId}::uuid FOR UPDATE`;
        await tx.riskControl.deleteMany({ where: { riskId, controlId: ctl } });
        locked();
        await held;
      },
      { timeout: 20_000 },
    );
    await isLocked;
    const pending = h.post(
      `/api/v1/risks/${riskId}/evidence-requests`,
      requestBody(h.userIds.carl, ctl),
      "cora",
    );
    for (let i = 0; i < 200; i++) {
      const [row] = await db.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'transactionid' AND NOT granted`;
      if ((row?.n ?? 0) > 0) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    release();
    await removal;
    const res = await pending;
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(detailPaths(res)).toEqual(["controlNotAccepted"]);
    expect(await db.task.count()).toBe(0);
  });

  it("lists open tasks first, flags overdue ones, and keeps completed ones for 30 days", async () => {
    const { riskId, ctl } = await h.riskWithAcceptedControl();
    const late = await requestEvidence(riskId, ctl, { title: "Late", dueDate: "2020-01-01" });
    await requestEvidence(riskId, ctl, { title: "Undated", dueDate: null });
    const old = await db.task.create({
      data: {
        kind: "evidence_request",
        title: "Old",
        assigneeId: h.userIds.carl,
        requestedById: h.userIds.cora,
        riskId,
        controlId: ctl,
        status: "done",
        completedAt: new Date(Date.now() - 40 * 24 * 3600 * 1000),
      },
    });
    const recent = await db.task.create({
      data: {
        kind: "evidence_request",
        title: "Recent",
        assigneeId: h.userIds.carl,
        requestedById: h.userIds.cora,
        riskId,
        controlId: ctl,
        status: "done",
        completedAt: new Date(),
      },
    });
    const items = tasks(await h.get("/api/v1/me/tasks", "carl"));
    expect(items.map((t) => t.title)).toEqual(["Late", "Undated", "Recent"]);
    expect(items.find((t) => t.id === late.id)?.overdue).toBe(true);
    expect(items.find((t) => t.id === recent.id)?.overdue).toBe(false);
    expect(items.some((t) => t.id === old.id)).toBe(false);
  });

  it("never drops an open task, however many completed ones there are", async () => {
    const { riskId, ctl } = await h.riskWithAcceptedControl();
    const base = {
      kind: "evidence_request" as const,
      assigneeId: h.userIds.carl,
      requestedById: h.userIds.cora,
      riskId,
      controlId: ctl,
    };
    await db.task.create({
      data: {
        ...base,
        title: "Oldest open",
        createdAt: new Date(Date.now() - 20 * 24 * 3600 * 1000),
      },
    });
    await db.task.createMany({
      data: Array.from({ length: 220 }, (_, i) => ({
        ...base,
        title: `Done ${String(i)}`,
        status: "done" as const,
        completedAt: new Date(),
      })),
    });
    const items = tasks(await h.get("/api/v1/me/tasks", "carl"));
    expect(items[0]?.title).toBe("Oldest open");
  });

  it("the assignee uploads against the task, which completes it; a second upload is 409 taskClosed", async () => {
    const { riskId, ctl } = await h.riskWithAcceptedControl();
    const task = await requestEvidence(riskId, ctl);
    const opts = { fileName: "restore-test.pdf", mimeType: "application/pdf" };

    // Only the assignee: anyone else (even the CISO) gets 404.
    expect((await h.uploadForTask("cora", task.id, pdf(), opts)).status).toBe(404);
    expect((await h.uploadForTask("sam", task.id, pdf(), opts)).status).toBe(404);

    const up = await h.uploadForTask("carl", task.id, pdf(), opts);
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    const evidence = up.body as EvidenceDto;
    expect(evidence.controls).toEqual([{ code: "CTL-01", title: "Backups are tested" }]);
    expect(evidence.uploadedBy.id).toBe(h.userIds.carl);

    const row = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(row.status).toBe("done");
    expect(row.completedAt).not.toBeNull();
    expect((await db.evidence.findUniqueOrThrow({ where: { id: evidence.id } })).taskId).toBe(
      task.id,
    );
    expect(await audits("evidence.added")).toHaveLength(1);
    const [completed] = await audits("task.completed");
    expect(completed?.objectId).toBe(task.id);
    expect(completed?.afterRef).toMatchObject({ status: "done", evidenceId: evidence.id });

    const [listed] = tasks(await h.get("/api/v1/me/tasks", "carl"));
    expect(listed?.status).toBe("done");

    const again = await h.uploadForTask("carl", task.id, pdf(), opts);
    expect(again.status).toBe(409);
    expect(detailPaths(again)).toEqual(["taskClosed"]);

    // The assignee may download what they uploaded; the risk record stays closed to them.
    const down = await h.downloadAs("carl", evidence.id);
    expect(down.status).toBe(200);
    const detail = (await h.get(`/api/v1/risks/${riskId}`, "cora")).body as RiskDetailDto;
    expect(detail.controls.find((c) => c.code === "CTL-01")?.evidenceCount).toBe(1);
  });

  it("records who completed an evidence request by upload", async () => {
    const { riskId, ctl } = await h.riskWithAcceptedControl();
    const task = await requestEvidence(riskId, ctl);
    const opts = { fileName: "restore-test.pdf", mimeType: "application/pdf" };
    expect((await h.uploadForTask("carl", task.id, pdf(), opts)).status).toBe(201);
    const row = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(row.completedById).toBe(h.userIds.carl);
  });

  it("refuses an upload against a treatment action that names a control (409 invalidTransition)", async () => {
    const { riskId, ctl } = await h.riskWithAcceptedControl();
    const action = await db.task.create({
      data: {
        kind: "treatment_action",
        title: "Test the restore",
        assigneeId: h.userIds.carl,
        requestedById: h.userIds.cora,
        riskId,
        controlId: ctl,
      },
    });
    const before = await objectKeys();
    const res = await h.uploadForTask("carl", action.id, pdf(), {
      fileName: "restore-test.pdf",
      mimeType: "application/pdf",
    });
    expect(res.status).toBe(409);
    expect(detailPaths(res)).toEqual(["invalidTransition"]);
    const row = await db.task.findUniqueOrThrow({ where: { id: action.id } });
    expect(row.status).toBe("open");
    expect(await db.evidence.count()).toBe(0);
    expect(await objectKeys()).toEqual(before);
    expect(await audits("task.completed")).toHaveLength(0);
  });

  it("two uploads racing for one task: one wins, the other is 409 and leaves no object", async () => {
    const { riskId, ctl } = await h.riskWithAcceptedControl();
    const task = await requestEvidence(riskId, ctl);
    const before = await objectKeys();
    const opts = { fileName: "restore-test.pdf", mimeType: "application/pdf" };
    const results = await Promise.all([
      h.uploadForTask("carl", task.id, pdf(), opts),
      h.uploadForTask("carl", task.id, pdf(), opts),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const rows = await db.evidence.findMany({ select: { objectKey: true } });
    expect(rows).toHaveLength(1);
    const added = [...(await objectKeys())].filter((k) => !before.has(k));
    expect(added).toEqual([rows[0]?.objectKey]);
  });
});
