import { loadLibrary, syncControlLibrary } from "@isms/control-library";
import { type Prisma, type PrismaClient, truncateAll } from "@isms/database";
import { type DemoActor, type DemoPorts, DemoPortsError, tryEach } from "./ports.js";

/**
 * The key of the transaction-scoped advisory lock that a reset and a load take first, so the
 * two serialise (a session-level lock would stay with whichever pooled connection took it).
 */
export const DEMO_LOCK = "isms:demo";

/**
 * Comfortably more than a load takes (about 1.5 s locally; the spec allows 30 s). The library
 * sync alone allows 60 s when it runs on its own.
 */
export const DEMO_TRANSACTION_OPTIONS = { timeout: 120_000, maxWait: 30_000 } as const;

/**
 * The reset's rows, inside the caller's transaction: take the demo lock, truncate, re-sync the
 * control library, then the first audit event of the new trail (`demo.reset`, the actor by
 * email since their user row is gone, stamped with the real time). TRUNCATE holds its locks
 * until the commit, so a concurrent sign-in waits and then sees the finished state.
 */
export async function resetRows(
  tx: Prisma.TransactionClient,
  actor: DemoActor,
): Promise<{ occurredAt: Date }> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${DEMO_LOCK}))`;
  await truncateAll({
    query: async (text) => ({
      rows: await tx.$queryRawUnsafe<Record<string, unknown>[]>(text),
    }),
  });
  await syncControlLibrary(tx, loadLibrary());
  const occurredAt = new Date();
  await tx.auditEvent.create({
    data: {
      occurredAt,
      actorUserId: null,
      action: "demo.reset",
      objectType: "instance",
      objectId: "instance",
      afterRef: { actorEmail: actor.email },
      requestId: "demo:reset",
    },
  });
  return { occurredAt };
}

/**
 * Returns the instance to a fresh install, as the owner role (the only way past the audit
 * trail's append-only trigger). One transaction (`resetRows`): the demo lock, TRUNCATE
 * everything but `_prisma_migrations` with RESTART IDENTITY (so the risk reference sequence
 * starts at 1), re-sync the control library, and record `demo.reset`. After the commit: drain
 * the queues first (#7), delete evidence files and sessions, and enqueue the library embedding.
 * A failed step does not stop the others: once all were tried, a DemoPortsError lists every
 * failure.
 *
 * Queued jobs that name deleted records are drained rather than left to fail; a job already
 * running finds no record and completes as a no-op (apps/worker/test/missing-risk.int.test.ts).
 */
export async function resetInstance(
  ownerDb: PrismaClient,
  ports: DemoPorts,
  actor: DemoActor,
): Promise<void> {
  await ownerDb.$transaction((tx) => resetRows(tx, actor), DEMO_TRANSACTION_OPTIONS);
  const failures = await tryEach([
    ["drainQueues", () => ports.drainQueues()],
    ["wipeEvidence", () => ports.wipeEvidence()],
    ["wipeSessions", () => ports.wipeSessions()],
    ["enqueueLibraryEmbed", () => ports.enqueueLibraryEmbed()],
  ]);
  if (failures.length > 0) throw new DemoPortsError("The reset was done", failures);
}
