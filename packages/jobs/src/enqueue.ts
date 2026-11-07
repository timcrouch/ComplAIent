import { DomainError } from "@isms/domain";
import { Queue, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";
import { createRedisConnection } from "./connection.js";
import { JobContracts, type JobName, type JobPayload } from "./contracts.js";

export type JobsClientOptions = {
  redisUrl: string;
  /** BullMQ key prefix (default "bull"). */
  prefix?: string;
  /** Default 5. */
  attempts?: number;
  /** Exponential backoff base in ms. Default 2000. */
  backoffDelay?: number;
  /**
   * For request paths (the API): commands fail at once while Redis is down instead of waiting
   * for it, and connection errors are swallowed (callers see the failed command). Workers
   * leave this off.
   */
  failFast?: boolean;
};

export type JobsClient = {
  enqueue<N extends JobName>(
    name: N,
    payload: JobPayload<N>,
    opts: { idempotencyKey: string },
  ): Promise<void>;
  /**
   * Registers (or updates) the repeating job for `name` on a cron `pattern` in UTC. A BullMQ job
   * scheduler has a fixed payload, so handlers must not rely on it for anything that changes
   * from run to run (use the current date, not the payload's).
   */
  schedule<N extends JobName>(name: N, pattern: string, payload: JobPayload<N>): Promise<void>;
  /**
   * Removes the job for this key when it has failed or completed, so the key can be enqueued
   * again. A waiting, active or delayed job is left alone.
   */
  removeFinished(name: JobName, idempotencyKey: string): Promise<void>;
  close(): Promise<void>;
};

/** BullMQ rejects ":" in custom job ids, so the id is `name__idempotencyKey`. */
export function jobIdFor(name: JobName, idempotencyKey: string): string {
  return `${name}__${idempotencyKey}`;
}

function failFastConnection(redisUrl: string): Redis {
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
  // Without a listener ioredis prints every reconnect failure; the failed command is the signal.
  redis.on("error", () => undefined);
  return redis;
}

function invalid(details?: { path: string; message: string }[]): DomainError {
  return new DomainError("VALIDATION_FAILED", "Invalid job", details);
}

/**
 * Producer side. Idempotency window: a job id stays reserved while its job exists. Completed
 * jobs are kept (last 1000) and failed jobs forever (removeOnFail: false), so re-enqueueing the
 * same key is a silent no-op until that job is removed. To retry on purpose, use a new key or
 * remove the old job. Note: this package pins ioredis 5 because bullmq 5 ships it; apps/api
 * uses ioredis 6.
 */
export function createJobsClient(options: JobsClientOptions): JobsClient {
  const connection: Redis = options.failFast
    ? failFastConnection(options.redisUrl)
    : createRedisConnection(options.redisUrl);
  const queues = new Map<string, Queue>();
  const jobOptions: JobsOptions = {
    attempts: options.attempts ?? 5,
    backoff: { type: "exponential", delay: options.backoffDelay ?? 2000 },
    removeOnComplete: 1000,
    removeOnFail: false,
  };

  function queueFor(name: string): Queue {
    let queue = queues.get(name);
    if (!queue) {
      queue = new Queue(name, {
        connection,
        ...(options.prefix === undefined ? {} : { prefix: options.prefix }),
      });
      queues.set(name, queue);
    }
    return queue;
  }

  return {
    async enqueue(name, payload, opts) {
      if (!Object.hasOwn(JobContracts, name)) throw invalid([{ path: "name", message: "unknown" }]);
      if (opts.idempotencyKey.length === 0 || opts.idempotencyKey.includes(":")) {
        throw invalid([{ path: "idempotencyKey", message: "invalid" }]);
      }
      const parsed = JobContracts[name].safeParse(payload);
      if (!parsed.success) {
        // Issue codes only: zod messages may echo the offending value.
        throw invalid(
          parsed.error.issues.map((issue) => ({
            path: issue.path.map(String).join("."),
            message: issue.code,
          })),
        );
      }
      await queueFor(name).add(name, parsed.data, {
        ...jobOptions,
        jobId: jobIdFor(name, opts.idempotencyKey),
      });
    },
    async schedule(name, pattern, payload) {
      if (!Object.hasOwn(JobContracts, name)) throw invalid([{ path: "name", message: "unknown" }]);
      if (pattern.trim().length === 0) throw invalid([{ path: "pattern", message: "invalid" }]);
      const parsed = JobContracts[name].safeParse(payload);
      if (!parsed.success) {
        throw invalid(
          parsed.error.issues.map((issue) => ({
            path: issue.path.map(String).join("."),
            message: issue.code,
          })),
        );
      }
      await queueFor(name).upsertJobScheduler(
        `${name}__daily`,
        { pattern, tz: "UTC" },
        { name, data: parsed.data, opts: jobOptions },
      );
    },
    async removeFinished(name, idempotencyKey) {
      const queue = queueFor(name);
      const job = await queue.getJob(jobIdFor(name, idempotencyKey));
      if (!job) return;
      const state = await job.getState();
      if (state === "failed" || state === "completed") await job.remove();
    },
    async close() {
      await Promise.all([...queues.values()].map((q) => q.close()));
      queues.clear();
      connection.disconnect();
    },
  };
}
