import { beforeEach, describe, expect, it, vi } from "vitest";

const upsertJobScheduler = vi.fn(() => Promise.resolve({}));
vi.mock("bullmq", () => ({
  Queue: class {
    upsertJobScheduler = upsertJobScheduler;
    close = () => Promise.resolve();
  },
}));
vi.mock("ioredis", () => ({
  Redis: class {
    on() {}
    disconnect() {}
  },
}));

const { JobContracts, createJobsClient } = await import("../src/index.js");

describe("JobsClient.schedule", () => {
  beforeEach(() => upsertJobScheduler.mockClear());
  const client = () => createJobsClient({ redisUrl: "redis://localhost:6379", failFast: true });

  it("upserts one UTC job scheduler per job name with the fixed payload", async () => {
    await client().schedule("risk.review_due", "0 2 * * *", { runOn: "2026-11-06" });
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      "risk.review_due__daily",
      { pattern: "0 2 * * *", tz: "UTC" },
      expect.objectContaining({ name: "risk.review_due", data: { runOn: "2026-11-06" } }),
    );
  });

  it("rejects an invalid payload or pattern before touching the queue", async () => {
    const c = client();
    await expect(
      c.schedule("risk.review_due", "0 2 * * *", { runOn: "tomorrow" }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(c.schedule("risk.review_due", "", { runOn: "2026-11-06" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    expect(upsertJobScheduler).not.toHaveBeenCalled();
  });

  it("defines the risk.review_due payload as an ISO date", () => {
    const schema = JobContracts["risk.review_due"];
    expect(schema.safeParse({ runOn: "2026-11-06" }).success).toBe(true);
    expect(schema.safeParse({ runOn: "2026-11-06T00:00:00Z" }).success).toBe(false);
  });
});
