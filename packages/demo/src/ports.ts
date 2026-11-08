import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { DEAD_LETTER_QUEUE, JobContracts, createRedisConnection } from "@isms/jobs";
import { Queue } from "bullmq";

/** One step outside the database that failed, and why. */
export type PortFailure = { step: string; message: string };

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Runs every step in order, carrying on after a failure, and returns the failures (#7): a
 * partly failed load or reset says everything that did not happen, not just the first thing.
 */
export async function tryEach(
  steps: readonly (readonly [string, () => Promise<unknown>])[],
): Promise<PortFailure[]> {
  const failures: PortFailure[] = [];
  for (const [step, run] of steps) {
    try {
      await run();
    } catch (err) {
      failures.push({ step, message: messageOf(err) });
    }
  }
  return failures;
}

/**
 * The database change committed, but steps outside it failed. Every step was still tried;
 * `failures` lists each failed one, in order.
 */
export class DemoPortsError extends Error {
  readonly failures: readonly PortFailure[];

  constructor(done: string, failures: readonly PortFailure[]) {
    const n = failures.length;
    const list = failures.map((f) => `${f.step}: ${f.message}`).join("; ");
    super(`${done}, but ${String(n)} follow-up ${n === 1 ? "step" : "steps"} failed: ${list}`);
    this.name = "DemoPortsError";
    this.failures = failures;
  }
}

/** What the reset and the load do outside the database. Fakes record calls in tests. */
export type DemoPorts = {
  /**
   * Deletes every object under "evidence/" (paged list, batched delete); returns how many.
   * Objects that cannot be deleted do not stop it: it throws once every page is done.
   */
  wipeEvidence(): Promise<number>;
  putEvidence(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** Deletes every `sess:*` key (SCAN, then UNLINK in batches); returns how many. */
  wipeSessions(): Promise<number>;
  /**
   * Drains the waiting and delayed jobs of every job queue and the dead-letter queue. A queue
   * that fails does not stop the others: it throws once every queue was tried.
   */
  drainQueues(): Promise<void>;
  /** Enqueues "library.embed" so the worker embeds the freshly synced library. */
  enqueueLibraryEmbed(): Promise<void>;
};

/** Who asked. A signed-in administrator, or the CLI (no sign-in, so no loader identity). */
export type DemoActor =
  { email: string; idpIssuer: string; idpSubject: string } | { email: string; cli: true };

/** The S3 settings of `storageConfig` (structurally the API's `StorageSettings`). */
export type StorageSettings = {
  S3_ENDPOINT: string;
  S3_REGION: string;
  S3_BUCKET: string;
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
  S3_FORCE_PATH_STYLE: boolean;
};

const EVIDENCE_PREFIX = "evidence/";
const SESSION_PATTERN = "sess:*";
const BATCH = 500;

export function createDefaultPorts(cfg: { s3: StorageSettings; redisUrl: string }): DemoPorts {
  const s3 = new S3Client({
    endpoint: cfg.s3.S3_ENDPOINT,
    region: cfg.s3.S3_REGION,
    forcePathStyle: cfg.s3.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: cfg.s3.S3_ACCESS_KEY_ID,
      secretAccessKey: cfg.s3.S3_SECRET_ACCESS_KEY,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const bucket = cfg.s3.S3_BUCKET;

  /** One short-lived connection per call: the CLI exits and the API calls this rarely. */
  async function withRedis<T>(
    fn: (redis: ReturnType<typeof createRedisConnection>) => Promise<T>,
  ): Promise<T> {
    const redis = createRedisConnection(cfg.redisUrl);
    redis.on("error", () => undefined);
    try {
      return await fn(redis);
    } finally {
      redis.disconnect();
    }
  }

  return {
    async wipeEvidence() {
      let deleted = 0;
      let failed = 0;
      let token: string | undefined;
      do {
        const page = await s3.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: EVIDENCE_PREFIX,
            ...(token ? { ContinuationToken: token } : {}),
          }),
        );
        const keys = (page.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
        if (keys.length > 0) {
          const res = await s3.send(
            new DeleteObjectsCommand({
              Bucket: bucket,
              Delete: { Objects: keys, Quiet: true },
            }),
          );
          const errors = res.Errors?.length ?? 0;
          failed += errors;
          deleted += keys.length - errors;
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      if (failed > 0) {
        throw new Error(
          `Could not delete ${String(failed)} evidence object(s); ${String(deleted)} deleted`,
        );
      }
      return deleted;
    },

    async putEvidence(key, body, contentType) {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentLength: body.byteLength,
          ContentType: contentType,
        }),
      );
    },

    wipeSessions() {
      return withRedis(async (redis) => {
        let deleted = 0;
        let cursor = "0";
        do {
          const [next, keys] = await redis.scan(cursor, "MATCH", SESSION_PATTERN, "COUNT", BATCH);
          cursor = next;
          if (keys.length > 0) deleted += await redis.unlink(...keys);
        } while (cursor !== "0");
        return deleted;
      });
    },

    drainQueues() {
      return withRedis(async (redis) => {
        const names = [...Object.keys(JobContracts), DEAD_LETTER_QUEUE];
        const failures = await tryEach(
          names.map((name) => [
            name,
            async () => {
              const queue = new Queue(name, { connection: redis });
              try {
                // `true` also drops delayed jobs. Running jobs are left to finish (the
                // handlers treat a missing risk as a no-op).
                await queue.drain(true);
              } finally {
                await queue.close();
              }
            },
          ]),
        );
        if (failures.length > 0) {
          const list = failures.map((f) => `${f.step} (${f.message})`).join(", ");
          throw new Error(`Could not drain ${String(failures.length)} queue(s): ${list}`);
        }
      });
    },

    enqueueLibraryEmbed() {
      return withRedis(async (redis) => {
        const queue = new Queue("library.embed", { connection: redis });
        try {
          await queue.add(
            "library.embed",
            { requestedAt: new Date().toISOString() },
            {
              attempts: 5,
              backoff: { type: "exponential", delay: 2000 },
              removeOnComplete: 1000,
              removeOnFail: false,
            },
          );
        } finally {
          await queue.close();
        }
      });
    },
  };
}
