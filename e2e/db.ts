import { databaseTestConfig, loadConfig } from "@isms/config";
import { loadLibrary, syncControlLibrary } from "@isms/control-library";
import { createPrismaClient } from "@isms/database";
import { resetTestDatabase } from "@isms/database/testing";
import { createJobsClient } from "@isms/jobs";
import { REDIS_URL } from "./env";

/**
 * e2e runs against isms_test (P2-R6). The API gets DATABASE_URL = DATABASE_TEST_URL from the
 * Playwright webServer env; these helpers use the owner connection to that database.
 */
const ownerUrl = (): string => loadConfig(databaseTestConfig).DATABASE_OWNER_TEST_URL;

async function withOwner<T>(fn: (db: ReturnType<typeof createPrismaClient>) => Promise<T>) {
  const db = createPrismaClient(ownerUrl());
  try {
    return await fn(db);
  } finally {
    await db.$disconnect();
  }
}

/** Empties isms_test (refusing any other database), then loads the shipped control library. */
export async function resetE2eDatabase(): Promise<void> {
  await resetTestDatabase(ownerUrl());
  await withOwner(async (db) => {
    await syncControlLibrary(db, loadLibrary());
  });
}

/**
 * After `email` has signed in, the API must have provisioned that user in isms_test. If not,
 * the API in use is another one (for example a local `pnpm dev` on the dev database).
 */
export async function assertApiUsesTestDatabase(email: string): Promise<void> {
  const user = await withOwner((db) => db.user.findFirst({ where: { email } }));
  if (!user) {
    throw new Error("The API is not using isms_test — stop `pnpm dev` and re-run `pnpm e2e`");
  }
}

/** Every audit action recorded in isms_test, oldest first. */
export async function auditActions(): Promise<string[]> {
  const rows = await withOwner((db) =>
    db.auditEvent.findMany({ select: { action: true }, orderBy: { occurredAt: "asc" } }),
  );
  return rows.map((r) => r.action);
}

/**
 * Asks the e2e worker to embed the control library in isms_test. The reset above removed the
 * embeddings the worker made when it started, and control suggestions retrieve through them.
 */
export async function requestLibraryEmbeddings(): Promise<void> {
  const jobs = createJobsClient({ redisUrl: REDIS_URL });
  try {
    await jobs.enqueue(
      "library.embed",
      { requestedAt: new Date().toISOString() },
      { idempotencyKey: `e2e-${String(Date.now())}` },
    );
  } finally {
    await jobs.close();
  }
}

/** Waits until every library control has an embedding (the first run downloads the model). */
export async function waitForLibraryEmbeddings(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  await withOwner(async (db) => {
    for (;;) {
      const [controls, embedded] = await Promise.all([
        db.control.count(),
        db.controlEmbedding.count(),
      ]);
      if (controls > 0 && embedded >= controls) return;
      if (Date.now() > deadline) {
        throw new Error(`Library embeddings not ready: ${String(embedded)} of ${String(controls)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  });
}

/** How many risks isms_test holds, any state (the demo spec checks the register against it). */
export async function riskCount(): Promise<number> {
  return withOwner((db) => db.risk.count());
}

/** One stored evidence file of the sample year: its risk, file name and SHA-256. */
export async function anEvidenceFile(): Promise<{
  riskId: string;
  fileName: string;
  sha256: string;
}> {
  const row = await withOwner((db) =>
    db.evidence.findFirst({
      select: { riskId: true, fileName: true, sha256: true },
      orderBy: { id: "asc" },
    }),
  );
  if (!row) throw new Error("No evidence file in isms_test");
  return row;
}
