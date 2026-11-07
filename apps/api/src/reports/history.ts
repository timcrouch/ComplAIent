/**
 * Counts at past instants, rebuilt from the risk version history (spec §4.2, §4.3).
 *
 * The rule: a risk's state and scores at instant `at` are those of its latest RiskVersion with
 * `createdAt < at`; versions are written in order, so the highest version number before `at` is it
 * (an index-friendly ORDER BY version DESC). A risk with no version before `at` did not exist
 * then. Open = the snapshot's state is not "closed"; above appetite = open and the snapshot's
 * (likelihood, impact) pair is one of `aboveAppetitePairs(threshold)`, today's threshold.
 *
 * P8-R2: visibility is judged on the risk's **current** row (`riskVisibilitySql`: its site,
 * department, owner, reporter and, for viewers, state now), not on the snapshot, so a risk that
 * moved site counts for its current site throughout. Every caller passes the actor.
 */
import { Prisma } from "@isms/database";
import type { Actor } from "../identity/index.js";
import type { PrismaService } from "../platform/index.js";
import { aboveAppetitePairs, riskVisibilitySql } from "../risks/index.js";

/** The latest version of risk `r` before the instant expression `at`, as `s(state, l, i)`. */
const latestBefore = (at: Prisma.Sql) => Prisma.sql`
  CROSS JOIN LATERAL (
    SELECT v.snapshot->>'state' AS state,
           (v.snapshot->>'likelihood')::int AS l,
           (v.snapshot->>'impact')::int AS i
    FROM "RiskVersion" v
    WHERE v."riskId" = r.id AND v."createdAt" < ${at}
    ORDER BY v.version DESC
    LIMIT 1
  ) s`;

/** Visible risks open, and open above appetite, at `at`. */
export async function countsAt(
  db: PrismaService,
  actor: Actor,
  at: Date,
  threshold: number,
): Promise<{ open: number; aboveAppetite: number }> {
  const pairs = aboveAppetitePairs(threshold);
  const above =
    pairs.length === 0
      ? Prisma.sql`FALSE`
      : Prisma.sql`(s.l, s.i) IN (${Prisma.join(
          pairs.map(([l, i]) => Prisma.sql`(${l}::int, ${i}::int)`),
        )})`;
  const [row] = await db.$queryRaw<{ open: bigint; above: bigint }[]>`
    SELECT count(*) FILTER (WHERE s.state <> 'closed') AS open,
           count(*) FILTER (WHERE s.state <> 'closed' AND ${above}) AS above
    FROM "Risk" r
    ${latestBefore(Prisma.sql`${at}::timestamptz`)}
    WHERE ${riskVisibilitySql(actor)}`;
  return { open: Number(row?.open ?? 0), aboveAppetite: Number(row?.above ?? 0) };
}

/** The same rule's `open` at each of `instants`, in order, in one query. */
export async function openAt(
  db: PrismaService,
  actor: Actor,
  instants: readonly Date[],
): Promise<number[]> {
  if (instants.length === 0) return [];
  const values = Prisma.join(
    instants.map((at, idx) => Prisma.sql`(${idx}::int, ${at}::timestamptz)`),
  );
  const rows = await db.$queryRaw<{ idx: number; open: bigint }[]>`
    SELECT t.idx, c.open
    FROM (VALUES ${values}) AS t(idx, at)
    CROSS JOIN LATERAL (
      SELECT count(*) AS open
      FROM "Risk" r
      ${latestBefore(Prisma.sql`t.at`)}
      WHERE ${riskVisibilitySql(actor)} AND s.state <> 'closed'
    ) c`;
  const open = instants.map(() => 0);
  for (const row of rows) open[row.idx] = Number(row.open);
  return open;
}
