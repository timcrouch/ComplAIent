import { randomUUID } from "node:crypto";
import { DomainError } from "@isms/domain";
import { Queue, UnrecoverableError } from "bullmq";
import { Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  type JobsClient,
  type ProcessorHandle,
  createJobsClient,
  createRedisConnection,
  registerProcessor,
} from "../src/index.js";

const redisUrl = process.env["REDIS_URL"] ?? "";
if (!redisUrl) throw new Error("REDIS_URL is required for integration tests");

const prefix = `test-${randomUUID()}`;
const NAME = "system.heartbeat";
const payload = { at: "2026-11-03T10:00:00.000Z" };

let connection: Redis;
let client: JobsClient | undefined;
let inspect: Queue;
let deadLetter: Queue;
const handles: ProcessorHandle[] = [];

async function waitFor(check: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timed out waiting for condition");
}

async function deleteTestKeys(): Promise<void> {
  const keys = await connection.keys(`${prefix}:*`);
  if (keys.length > 0) await connection.del(...keys);
}

beforeAll(() => {
  connection = createRedisConnection(redisUrl);
  inspect = new Queue(NAME, { connection, prefix });
  deadLetter = new Queue("dead-letter", { connection, prefix });
});

afterEach(async () => {
  await Promise.all(handles.splice(0).map((h) => h.close()));
  await client?.close();
  client = undefined;
  await inspect.obliterate({ force: true });
  await deadLetter.obliterate({ force: true });
});

afterAll(async () => {
  await inspect.close();
  await deadLetter.close();
  await deleteTestKeys();
  connection.disconnect();
});

describe("jobs", () => {
  function newClient(): JobsClient {
    const created = createJobsClient({ redisUrl, prefix, attempts: 2, backoffDelay: 20 });
    client = created;
    return created;
  }

  it("deduplicates by idempotency key", async () => {
    const c = newClient();
    await c.enqueue(NAME, payload, { idempotencyKey: "same" });
    await c.enqueue(NAME, payload, { idempotencyKey: "same" });
    await c.enqueue(NAME, payload, { idempotencyKey: "other" });
    expect(await inspect.getJobCountByTypes("waiting", "delayed", "active")).toBe(2);
  });

  it("builds a deterministic job id without a colon", async () => {
    const c = newClient();
    await c.enqueue(NAME, payload, { idempotencyKey: "abc" });
    const job = await inspect.getJob(`${NAME}__abc`);
    expect(job?.data).toEqual(payload);
    expect(job?.opts.attempts).toBe(2);
  });

  it("rejects invalid payload before enqueue, without echoing values", async () => {
    const c = newClient();
    const err = await c
      .enqueue(NAME, { at: "nope" }, { idempotencyKey: "bad" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe("VALIDATION_FAILED");
    expect(JSON.stringify((err as DomainError).details)).not.toContain("nope");
    expect((err as DomainError).details?.[0]?.path).toBe("at");
    expect(await inspect.getJobCountByTypes("waiting", "delayed", "active")).toBe(0);
  });

  it("rejects an idempotency key that BullMQ cannot use", async () => {
    const c = newClient();
    await expect(c.enqueue(NAME, payload, { idempotencyKey: "a:b" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(c.enqueue(NAME, payload, { idempotencyKey: "" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });

  it("processes heartbeat with the parsed payload", async () => {
    const c = newClient();
    const received: unknown[] = [];
    handles.push(
      registerProcessor(
        NAME,
        (p) => {
          received.push(p);
          return Promise.resolve();
        },
        { connection, prefix },
      ),
    );
    await c.enqueue(NAME, payload, { idempotencyKey: "hb" });
    await waitFor(() => Promise.resolve(received.length === 1));
    expect(received).toEqual([payload]);
  });

  it("tells the handler which attempt it is and the most it will get", async () => {
    const c = newClient();
    const seen: unknown[] = [];
    handles.push(
      registerProcessor(
        NAME,
        (_p, attempt) => {
          seen.push(attempt);
          return Promise.reject(new Error("again"));
        },
        { connection, prefix, logger: { error: () => undefined } },
      ),
    );
    await c.enqueue(NAME, payload, { idempotencyKey: "attempts" });
    await waitFor(() => Promise.resolve(seen.length === 2));
    expect(seen).toEqual([
      { attempt: 1, maxAttempts: 2 },
      { attempt: 2, maxAttempts: 2 },
    ]);
  });

  it("moves an exhausted job to dead-letter and logs without the payload", async () => {
    const c = newClient();
    const logged: { obj: Record<string, unknown>; msg: string }[] = [];
    let calls = 0;
    handles.push(
      registerProcessor(
        NAME,
        () => {
          calls += 1;
          return Promise.reject(new Error("boom"));
        },
        {
          connection,
          prefix,
          logger: { error: (obj, msg) => logged.push({ obj, msg }) },
        },
      ),
    );
    await c.enqueue(NAME, payload, { idempotencyKey: "dead" });
    await waitFor(async () => (await deadLetter.getJobCountByTypes("waiting")) === 1);

    expect(calls).toBe(2);
    const [entry] = await deadLetter.getJobs(["waiting"]);
    expect(entry?.data).toEqual({
      originalQueue: NAME,
      jobId: `${NAME}__dead`,
      failedReason: "boom",
      payload,
    });
    await waitFor(() => Promise.resolve(logged.length === 1));
    expect(logged[0]?.obj).toMatchObject({ jobName: NAME, jobId: `${NAME}__dead` });
    expect(JSON.stringify(logged)).not.toContain(payload.at);
  });

  describe("dead-letter edge cases", () => {
    const dlqCount = (): Promise<number> => deadLetter.getJobCountByTypes("waiting");
    const register = (
      handler: (p: unknown) => Promise<void>,
      extra: { beforeDeadLetterAdd?: () => Promise<void> } = {},
    ): ProcessorHandle => {
      const handle = registerProcessor(NAME, handler, {
        connection,
        prefix,
        logger: { error: () => undefined },
        ...extra,
      });
      handles.push(handle);
      return handle;
    };

    it("dead-letters a job added without attempts after one try (BullMQ default)", async () => {
      let calls = 0;
      register(() => {
        calls += 1;
        return Promise.reject(new Error("boom"));
      });
      await inspect.add(NAME, payload, { jobId: "raw" });
      await waitFor(async () => (await dlqCount()) === 1);
      expect(calls).toBe(1);
    });

    it("keeps the dead-letter entry when close() follows the final failure immediately", async () => {
      let failed!: () => void;
      const handlerRan = new Promise<void>((resolve) => {
        failed = resolve;
      });
      const handle = register(
        () => {
          failed();
          return Promise.reject(new Error("boom"));
        },
        // Widens the race: without awaiting pending pushes, close() would resolve first.
        { beforeDeadLetterAdd: () => new Promise((resolve) => setTimeout(resolve, 200)) },
      );
      await inspect.add(NAME, payload, { jobId: "race" });
      await handlerRan;
      await handle.close();
      expect(await dlqCount()).toBe(1);
    });

    it("dead-letters an UnrecoverableError after a single call", async () => {
      const c = newClient();
      let calls = 0;
      register(() => {
        calls += 1;
        return Promise.reject(new UnrecoverableError("never"));
      });
      await c.enqueue(NAME, payload, { idempotencyKey: "unrec" });
      await waitFor(async () => (await dlqCount()) === 1);
      expect(calls).toBe(1);
    });

    it("dead-letters a payload that breaks the contract without retries or handler calls", async () => {
      let calls = 0;
      register(() => {
        calls += 1;
        return Promise.resolve();
      });
      await inspect.add(NAME, { at: "nope" }, { jobId: "broken", attempts: 3 });
      await waitFor(async () => (await dlqCount()) === 1);
      expect(calls).toBe(0);
      const [entry] = await deadLetter.getJobs(["waiting"]);
      expect(entry?.data).toMatchObject({ originalQueue: NAME, payload: { at: "nope" } });
    });

    it("does not dead-letter before the final attempt", async () => {
      let calls = 0;
      register(() => {
        calls += 1;
        return Promise.reject(new Error("boom"));
      });
      await inspect.add(NAME, payload, {
        jobId: "retrying",
        attempts: 3,
        backoff: { type: "fixed", delay: 5000 },
      });
      await waitFor(() => Promise.resolve(calls === 1));
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(await dlqCount()).toBe(0);
    });

    it("deduplicates a repeated failed event for the same job", async () => {
      const handle = register(() => Promise.reject(new Error("boom")));
      await inspect.add(NAME, payload, { jobId: "dup" });
      await waitFor(async () => (await dlqCount()) === 1);
      const job = await inspect.getJob("dup");
      handle.worker.emit("failed", job as never, new Error("boom"), "active");
      await handle.close();
      expect(await dlqCount()).toBe(1);
    });

    it("gives a re-run job that fails again its own dead-letter entry", async () => {
      register(() => Promise.reject(new Error("boom")));
      await inspect.add(NAME, payload, { jobId: "rerun" });
      await waitFor(async () => (await dlqCount()) === 1);
      await (await inspect.getJob("rerun"))?.remove();
      await new Promise((resolve) => setTimeout(resolve, 5));
      await inspect.add(NAME, payload, { jobId: "rerun" });
      await waitFor(async () => (await dlqCount()) === 2);
    });

    it("caps failedReason at 1000 characters", async () => {
      register(() => Promise.reject(new Error("x".repeat(5000))));
      await inspect.add(NAME, payload, { jobId: "long" });
      await waitFor(async () => (await dlqCount()) === 1);
      const [entry] = await deadLetter.getJobs(["waiting"]);
      expect((entry?.data as { failedReason: string }).failedReason).toHaveLength(1000);
    });
  });
});
