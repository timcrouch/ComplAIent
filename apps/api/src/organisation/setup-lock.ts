import type { Prisma } from "@isms/database";
import type { PrismaService } from "../platform/index.js";

/** Advisory lock that serialises every organisation setup write. */
export const SETUP_LOCK = "isms:organisation-setup";

/**
 * Runs `fn` in one transaction that first takes the setup lock, so concurrent setup saves
 * apply one after the other, each seeing what the previous one committed.
 */
export function withSetupLock<T>(
  prisma: PrismaService,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${SETUP_LOCK}))`;
      return fn(tx);
    },
    { timeout: 15_000 },
  );
}
