import "./instrument.js";
import { resolve } from "node:path";
import { createGateway, createLocalEmbedder, createPrismaAiStore } from "@isms/ai";
import {
  aiConfig,
  assertNotMockInProduction,
  databaseConfig,
  embeddingsConfig,
  formatConfigErrorAndExit,
  loadConfig,
  redisConfig,
  telemetryConfig,
  workerConfig,
} from "@isms/config";
import { createPrismaClient } from "@isms/database";
import { isoDateUtc } from "@isms/domain";
import {
  createJobsClient,
  createRedisConnection,
  registerProcessor,
  type ProcessorHandle,
} from "@isms/jobs";
import { createLogger, shutdownTelemetry } from "@isms/telemetry";
import { startHealthServer, type HealthServer } from "./health.js";
import { embedLibrary } from "./jobs/embed-library.js";
import { reviewDue } from "./jobs/review-due.js";
import { heartbeat } from "./jobs/heartbeat.js";
import { suggestControls } from "./jobs/suggest-controls.js";
import { registerJobCountGauge } from "./metrics.js";

const FORCE_EXIT_MS = 30_000;

async function main(): Promise<void> {
  let config;
  try {
    config = {
      ...loadConfig(redisConfig),
      ...loadConfig(telemetryConfig),
      ...loadConfig(workerConfig),
      ...loadConfig(databaseConfig),
      ...loadConfig(aiConfig),
      ...loadConfig(embeddingsConfig),
    };
    assertNotMockInProduction(config);
  } catch (err) {
    return formatConfigErrorAndExit(err);
  }
  const logger = createLogger({ level: config.LOG_LEVEL, service: "isms-worker" });
  const connection = createRedisConnection(config.REDIS_URL);
  // The app role: the worker has no more database rights than the API.
  const db = createPrismaClient(config.DATABASE_URL);
  const jobs = createJobsClient({ redisUrl: config.REDIS_URL });
  // The same readiness, privacy routing and AiInteraction recording as the API (ADR-0009).
  const gateway = createGateway({
    store: createPrismaAiStore(db),
    secretsKey: config.AI_SECRETS_KEY,
    provider: config.AI_PROVIDER,
    allowNonEuRouting: config.AI_ALLOW_NON_EU_ROUTING,
    logger,
  });
  // Embeddings are computed here; user text never leaves the installation for them (ADR-0011).
  const embedder = createLocalEmbedder({ cacheDir: resolve(config.EMBEDDINGS_CACHE_DIR) });
  const processors: ProcessorHandle[] = [];
  let health: HealthServer | undefined;

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "isms-worker shutting down");
    setTimeout(() => {
      logger.error({ signal }, "shutdown timed out, forcing exit");
      process.exit(1);
    }, FORCE_EXIT_MS).unref();
    try {
      await health?.close();
      await Promise.all(processors.map((p) => p.close()));
      await jobs.close();
      await connection.quit();
      await db.$disconnect();
      await shutdownTelemetry();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "shutdown failed");
      process.exit(1);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  try {
    processors.push(
      registerProcessor("system.heartbeat", (payload) => heartbeat(payload, logger), {
        connection,
        logger,
      }),
      registerProcessor(
        "library.embed",
        async (payload) => {
          await embedLibrary({ db, embedder, logger }, payload);
        },
        { connection, logger },
      ),
      registerProcessor(
        "risk.suggest_controls",
        (payload, attempt) => suggestControls({ db, gateway, embedder, logger }, payload, attempt),
        { connection, logger },
      ),
      registerProcessor(
        "risk.review_due",
        async () => {
          // The scheduler's payload is fixed; a run always uses the current date.
          await reviewDue({ db, logger }, new Date());
        },
        { connection, logger },
      ),
    );
    // Once per start: picks up library syncs and model changes. A fresh key, because completed
    // jobs keep their id reserved.
    const requestedAt = new Date().toISOString();
    await jobs.enqueue(
      "library.embed",
      { requestedAt },
      { idempotencyKey: `startup-${String(Date.now())}` },
    );
    // Daily at 02:00 UTC, plus once per start (once per day: the key is today's date) so a
    // worker that was down at 02:00 still catches up.
    const runOn = isoDateUtc(new Date());
    await jobs.schedule("risk.review_due", "0 2 * * *", { runOn });
    await jobs.enqueue("risk.review_due", { runOn }, { idempotencyKey: runOn });
    registerJobCountGauge(processors.flatMap((p) => [p.queue, p.deadLetter]));
    health = await startHealthServer(config.WORKER_HEALTH_PORT);
    logger.info(
      { healthPort: config.WORKER_HEALTH_PORT, metricsPort: config.WORKER_METRICS_PORT },
      "isms-worker started",
    );
  } catch (err) {
    logger.error({ err }, "isms-worker failed to start");
    process.exit(1);
  }
}

void main();
