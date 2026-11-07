import { createLogger } from "@isms/telemetry";
import { Queue, UnrecoverableError, Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";
import {
  DEAD_LETTER_QUEUE,
  JobContracts,
  type DeadLetterPayload,
  type JobName,
  type JobPayload,
} from "./contracts.js";

const FAILED_REASON_MAX = 1000;
const DEAD_LETTER_TRIES = 3;
const DEAD_LETTER_RETRY_MS = 100;

export type JobLogger = {
  error(obj: Record<string, unknown>, msg: string): void;
  debug?(obj: Record<string, unknown>, msg: string): void;
};

export type ProcessorOptions = {
  connection: Redis;
  prefix?: string;
  /** Retry ceiling for jobs that carry no `attempts` of their own. Default 1 (BullMQ's default). */
  attempts?: number;
  /** Receives job name and id only, never payloads. */
  logger?: JobLogger;
  /** Test hook: awaited before each dead-letter add (used to widen the shutdown race). */
  beforeDeadLetterAdd?: () => Promise<void>;
};

/** Which try this is (1-based) and the most the job will get, so a handler can tell the last one. */
export type JobAttempt = { attempt: number; maxAttempts: number };

export type ProcessorHandle = {
  worker: Worker;
  /** The job's own queue, for metrics. */
  queue: Queue;
  /** The shared dead-letter queue, for metrics. */
  deadLetter: Queue;
  close(): Promise<void>;
};

export function registerProcessor<N extends JobName>(
  name: N,
  handler: (payload: JobPayload<N>, attempt: JobAttempt) => Promise<void>,
  options: ProcessorOptions,
): ProcessorHandle {
  const { connection } = options;
  const common = {
    connection,
    ...(options.prefix === undefined ? {} : { prefix: options.prefix }),
  };
  const logger: JobLogger = options.logger ?? createLogger({ level: "info", service: "isms-jobs" });
  const queue = new Queue(name, common);
  const deadLetter = new Queue(DEAD_LETTER_QUEUE, {
    ...common,
    defaultJobOptions: { attempts: 1, removeOnComplete: false, removeOnFail: false },
  });

  const worker = new Worker(
    name,
    async (job: Job) => {
      const parsed = JobContracts[name].safeParse(job.data);
      // A payload that no longer matches the contract will never succeed: skip retries.
      if (!parsed.success) throw new UnrecoverableError("Payload does not match job contract");
      // TypeScript cannot narrow the union of payloads by the generic name; the schema is name's own.
      await handler(parsed.data as JobPayload<N>, {
        attempt: job.attemptsMade + 1,
        maxAttempts: job.opts.attempts ?? options.attempts ?? 1,
      });
    },
    common,
  );

  const pending = new Set<Promise<void>>();

  async function addToDeadLetter(job: Job, err: Error): Promise<void> {
    const entry: DeadLetterPayload = {
      originalQueue: name,
      jobId: job.id,
      failedReason: err.message.slice(0, FAILED_REASON_MAX),
      payload: job.data,
    };
    const ids = { jobName: name, jobId: job.id };
    for (let attempt = 1; ; attempt += 1) {
      try {
        await options.beforeDeadLetterAdd?.();
        // Original id plus failure time: a repeated `failed` event for the same failure dedupes,
        // a later failure of a re-run job (same id) gets its own entry.
        const deadId =
          job.id === undefined
            ? undefined
            : `${job.id}__${String(job.finishedOn ?? job.timestamp)}`;
        if (deadId !== undefined && (await deadLetter.getJob(deadId))) {
          logger.debug?.(ids, "duplicate failed event, dead-letter entry already exists");
          return;
        }
        await deadLetter.add(
          DEAD_LETTER_QUEUE,
          entry,
          deadId === undefined ? {} : { jobId: deadId },
        );
        logger.error({ ...ids, attempts: job.attemptsMade }, "job moved to dead-letter");
        return;
      } catch (addErr) {
        if (attempt >= DEAD_LETTER_TRIES) {
          const errName = addErr instanceof Error ? addErr.name : "unknown";
          logger.error({ ...ids, errName }, "failed to move job to dead-letter");
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, DEAD_LETTER_RETRY_MS * attempt));
      }
    }
  }

  worker.on("failed", (job, err) => {
    if (!job) return;
    // BullMQ's own default is a single attempt.
    const maxAttempts = job.opts.attempts ?? options.attempts ?? 1;
    const exhausted = err instanceof UnrecoverableError || job.attemptsMade >= maxAttempts;
    if (!exhausted) return;
    const task = addToDeadLetter(job, err).finally(() => pending.delete(task));
    pending.add(task);
  });
  worker.on("error", (err) => {
    logger.error({ jobName: name, errName: err.name }, "worker error");
  });

  return {
    worker,
    queue,
    deadLetter,
    async close() {
      // Let in-flight jobs finish (their `failed` events fire), then flush dead-letter pushes.
      await worker.close();
      await Promise.allSettled([...pending]);
      await queue.close();
      await deadLetter.close();
    },
  };
}
