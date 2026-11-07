import type { Prisma } from "@isms/database";
import { DEFAULT_REVIEW_INTERVAL_MONTHS } from "@isms/domain";
import type { AuditContext, AuditService } from "../audit/index.js";

type Tx = Prisma.TransactionClient;

/** A `@db.Date` value: UTC midnight of a YYYY-MM-DD string. */
export const dateOnly = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

/** The organisation's review interval, read inside the caller's transaction. */
export async function reviewIntervalMonths(tx: Tx): Promise<number> {
  const org = await tx.organisation.findFirst({ select: { reviewIntervalMonths: true } });
  return org?.reviewIntervalMonths ?? DEFAULT_REVIEW_INTERVAL_MONTHS;
}

/**
 * Completes every open periodic_review task of the risk (an approval or a confirmation makes
 * the review redundant), one `task.completed` audit event each.
 */
export async function completeOpenReviewTasks(
  tx: Tx,
  audit: AuditService,
  riskId: string,
  actorId: string,
  note: string,
  ctx: AuditContext,
): Promise<void> {
  const open = await tx.task.findMany({
    where: { riskId, kind: "periodic_review", status: "open" },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  for (const { id } of open) {
    await tx.task.update({
      where: { id },
      data: {
        status: "done",
        completedAt: new Date(),
        completedById: actorId,
        completionNote: note,
      },
      select: { id: true },
    });
    await audit.record(
      {
        action: "task.completed",
        objectType: "Task",
        objectId: id,
        before: { status: "open" },
        after: { status: "done", riskId, note: { length: note.length } },
      },
      ctx,
      tx,
    );
  }
}
