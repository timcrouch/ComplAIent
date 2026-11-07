import { Prisma, type PrismaClient } from "@isms/database";
import { isoDateUtc } from "@isms/domain";

type Logger = { info(obj: Record<string, unknown>, msg?: string): void };

/**
 * A UUIDv7 made in SQL, like the ids Prisma generates for the app (`uuid(7)`): the Unix time
 * in milliseconds in the first 48 bits over a random v4 UUID, with the version bits set to 7.
 * Postgres 17 has no `uuidv7()`; volatile, so each inserted row gets its own id.
 */
const UUID_V7_SQL = Prisma.raw(`encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid())
  placing substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
  FROM 1 FOR 6), 52, 1), 53, 1), 'hex')::uuid`);

/**
 * Creates a "Review this risk" task for every approved or closed risk whose review is due
 * (today or earlier, UTC) and that has an owner and no open review task. One statement:
 * candidates are chosen and inserted together, and the unique partial index
 * "Task_one_open_periodic_review" with `ON CONFLICT DO NOTHING` drops a duplicate from a
 * parallel run, so only the rows actually inserted are counted. Logs counts only. `now` is the
 * run time, never the job payload.
 */
export async function reviewDue(
  { db, logger }: { db: PrismaClient; logger: Logger },
  now: Date,
): Promise<{ created: number }> {
  const today = isoDateUtc(now);
  const inserted = await db.$queryRaw<
    { id: string }[]
  >`INSERT INTO "Task" (id, kind, title, "assigneeId", "requestedById", "dueDate", "riskId", "updatedAt")
     SELECT ${UUID_V7_SQL}, 'periodic_review'::"TaskKind", 'Review this risk',
            r."ownerId", r."ownerId", r."nextReviewDue", r.id, now()
     FROM "Risk" r
     WHERE r.state IN ('approved', 'closed')
       AND r."nextReviewDue" <= ${today}::date
       AND r."ownerId" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM "Task" t
         WHERE t."riskId" = r.id AND t.kind = 'periodic_review' AND t.status = 'open')
     ORDER BY r.id
     ON CONFLICT DO NOTHING
     RETURNING id::text`;
  const skippedNoOwner = await db.risk.count({
    where: {
      state: { in: ["approved", "closed"] },
      nextReviewDue: { lte: new Date(`${today}T00:00:00.000Z`) },
      ownerId: null,
    },
  });
  const created = inserted.length;
  logger.info({ job: "risk.review_due", created, skippedNoOwner }, "review tasks created");
  return { created };
}
