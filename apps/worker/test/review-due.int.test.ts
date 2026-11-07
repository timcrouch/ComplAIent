import { databaseTestConfig, loadConfig } from "@isms/config";
import { createPrismaClient } from "@isms/database";
import { resetTestDatabase } from "@isms/database/testing";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { reviewDue } from "../src/jobs/review-due.js";

const env = loadConfig(databaseTestConfig);
const app = createPrismaClient(env.DATABASE_TEST_URL);
const owner = createPrismaClient(env.DATABASE_OWNER_TEST_URL);
const NOW = new Date("2026-11-06T02:00:00.000Z");
const logger = { info: vi.fn(), warn: vi.fn() };
const deps = () => ({ db: app, logger });

let userId = "";

async function risk(
  over: { state?: "proposed" | "approved" | "closed"; due?: string | null; owned?: boolean } = {},
) {
  const { state = "approved", due = "2026-11-06", owned = true } = over;
  return owner.risk.create({
    data: {
      title: "Lost laptop",
      scenario: "s",
      threat: "t",
      consequence: "c",
      reporterId: userId,
      aiAssisted: false,
      state,
      ownerId: owned ? userId : null,
      nextReviewDue: due === null ? null : new Date(`${due}T00:00:00.000Z`),
    },
  });
}
const tasks = () => owner.task.findMany({ orderBy: { createdAt: "asc" } });

beforeEach(async () => {
  logger.info.mockClear();
  logger.warn.mockClear();
  await resetTestDatabase();
  userId = (
    await owner.user.create({
      data: { idpIssuer: "i", idpSubject: "s", email: "w@example.test", displayName: "W" },
    })
  ).id;
});
afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

describe("reviewDue", () => {
  it("creates one review task for a due approved risk", async () => {
    const r = await risk({ due: "2026-11-01" });
    expect(await reviewDue(deps(), NOW)).toEqual({ created: 1 });
    const [task, ...rest] = await tasks();
    expect(rest).toEqual([]);
    expect(task).toMatchObject({
      kind: "periodic_review",
      title: "Review this risk",
      riskId: r.id,
      assigneeId: userId,
      requestedById: userId,
      status: "open",
    });
    expect(task?.dueDate?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("gives each task its own UUIDv7 id, like the app's", async () => {
    await Promise.all([risk(), risk()]);
    const before = Date.now();
    await reviewDue(deps(), NOW);
    const ids = (await tasks()).map((t) => t.id);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      const ms = parseInt(id.replace(/-/g, "").slice(0, 12), 16);
      expect(Math.abs(ms - before)).toBeLessThan(60_000);
    }
  });

  it("covers closed risks and a review due today", async () => {
    await risk({ state: "closed", due: "2026-11-06" });
    expect(await reviewDue(deps(), NOW)).toEqual({ created: 1 });
  });

  it("running twice still leaves one task", async () => {
    await risk();
    await reviewDue(deps(), NOW);
    expect(await reviewDue(deps(), NOW)).toEqual({ created: 0 });
    expect(await tasks()).toHaveLength(1);
  });

  it("two parallel runs leave one task", async () => {
    await Promise.all([risk(), risk(), risk()]);
    const results = await Promise.all([reviewDue(deps(), NOW), reviewDue(deps(), NOW)]);
    expect(results.reduce((n, r) => n + r.created, 0)).toBe(3);
    expect(await tasks()).toHaveLength(3);
  });

  it("skips not-due, proposed and unscheduled risks", async () => {
    await risk({ due: "2026-11-07" });
    await risk({ state: "proposed", due: "2026-10-01" });
    await risk({ due: null });
    expect(await reviewDue(deps(), NOW)).toEqual({ created: 0 });
    expect(await tasks()).toEqual([]);
  });

  it("creates a new task once the earlier one is done", async () => {
    await risk();
    await reviewDue(deps(), NOW);
    await owner.task.updateMany({ data: { status: "done" } });
    expect(await reviewDue(deps(), NOW)).toEqual({ created: 1 });
    expect(await tasks()).toHaveLength(2);
  });

  it("skips risks without an owner and logs the count only", async () => {
    await risk({ owned: false });
    await risk();
    expect(await reviewDue(deps(), NOW)).toEqual({ created: 1 });
    expect(JSON.stringify(logger.info.mock.calls)).toContain('"created":1');
    expect(JSON.stringify(logger.info.mock.calls)).toContain('"skippedNoOwner":1');
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("Lost laptop");
  });
});
