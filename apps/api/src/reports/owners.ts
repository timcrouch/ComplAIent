/**
 * The board pack's owner breakout (spec §4.4), over the risks the actor may see, grouped by the
 * risk's **current** owner. Owner rows are never part of the AI narrative input.
 */
import type { BoardOwnerRowDto } from "@isms/contracts";
import type { Actor } from "../identity/index.js";
import type { PrismaService } from "../platform/index.js";
import { overdueTaskWhere, riskVisibilitySql, riskVisibilityWhere } from "../risks/index.js";

/**
 * One row per owner with at least one visible risk, plus Unassigned (ownerId null):
 * - owned: all, any state; open: state not closed; closedNow = owned − open;
 * - treatedInPeriod: risks with a version that changed the state to closed in [from, until)
 *   (the Treated tile's rule), each risk once however often it was closed;
 * - overdueActions: open treatment actions due before `today` on those risks.
 * Sorted by open descending, then name; Unassigned last on ties.
 */
export async function ownerRows(
  db: PrismaService,
  actor: Actor,
  from: Date,
  until: Date,
  today: string,
): Promise<BoardOwnerRowDto[]> {
  const [rows, overdue] = await Promise.all([
    db.$queryRaw<
      {
        ownerId: string | null;
        owner: string | null;
        owned: bigint;
        open: bigint;
        treated: bigint;
      }[]
    >`
      SELECT r."ownerId" AS "ownerId", u."displayName" AS owner,
             count(*) AS owned,
             count(*) FILTER (WHERE r.state <> 'closed') AS open,
             count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM "RiskVersion" v
               WHERE v."riskId" = r.id AND 'state' = ANY(v."changedFields")
                 AND v.snapshot->>'state' = 'closed'
                 AND v."createdAt" >= ${from}::timestamptz AND v."createdAt" < ${until}::timestamptz
             )) AS treated
      FROM "Risk" r LEFT JOIN "User" u ON u.id = r."ownerId"
      WHERE ${riskVisibilitySql(actor)}
      GROUP BY r."ownerId", u."displayName"`,
    db.task.findMany({
      where: {
        ...overdueTaskWhere(today),
        kind: "treatment_action",
        risk: riskVisibilityWhere(actor),
      },
      select: { risk: { select: { ownerId: true } } },
    }),
  ]);
  const overdueBy = new Map<string | null, number>();
  for (const task of overdue) {
    const key = task.risk.ownerId;
    overdueBy.set(key, (overdueBy.get(key) ?? 0) + 1);
  }
  return rows
    .map((r) => {
      const owned = Number(r.owned);
      const open = Number(r.open);
      return {
        ownerId: r.ownerId,
        owner: r.ownerId === null ? null : r.owner,
        owned,
        open,
        closedNow: owned - open,
        treatedInPeriod: Number(r.treated),
        overdueActions: overdueBy.get(r.ownerId) ?? 0,
      };
    })
    .sort(
      (a, b) =>
        b.open - a.open ||
        Number(a.ownerId === null) - Number(b.ownerId === null) ||
        (a.owner ?? "").localeCompare(b.owner ?? ""),
    );
}
