import { Inject, Injectable } from "@nestjs/common";
import type { RiskMapResponse } from "@isms/contracts";
import { Prisma } from "@isms/database";
import { type MapBasis, recentWeekStarts } from "@isms/domain";
import type { Actor } from "../identity/index.js";
import { RiskScaleService } from "../organisation/index.js";
import { PRISMA, type PrismaService } from "../platform/index.js";
import { MAP_IMPACT_RESIDUAL_SQL, MAP_LIKELIHOOD_RESIDUAL_SQL } from "./risk-cell.js";
import { riskVisibilitySql } from "./risk-visibility.js";

const MOVEMENT_WEEKS = 12;

export type MovementWeek = {
  weekStart: string;
  reported: number;
  approved: number;
  closed: number;
};

/** Aggregates over the risks the actor may see: the risk map and the weekly movement. */
@Injectable()
export class RiskInsightsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly scale: RiskScaleService,
  ) {}

  /** Every visible risk counted once: in a cell, unscored, or (residual only) unplaced. */
  async map(actor: Actor, basis: MapBasis, includeClosed = false): Promise<RiskMapResponse> {
    const { appetiteThreshold } = await this.scale.currentAppetite();
    const inherent = basis === "inherent";
    const likelihood = inherent ? Prisma.sql`r.likelihood` : MAP_LIKELIHOOD_RESIDUAL_SQL;
    const impact = inherent ? Prisma.sql`r.impact` : MAP_IMPACT_RESIDUAL_SQL;
    const rows = await this.prisma.$queryRaw<
      { likelihood: number | null; impact: number | null; unscored: boolean; n: bigint }[]
    >`
      SELECT ${likelihood} AS likelihood, ${impact} AS impact,
             (r.likelihood IS NULL OR r.impact IS NULL) AS unscored, count(*) AS n
      FROM "Risk" r
      WHERE ${riskVisibilitySql(actor)}
        AND (${includeClosed} OR r.state <> 'closed')
      GROUP BY 1, 2, 3
      ORDER BY 1 DESC NULLS LAST, 2 ASC NULLS LAST`;
    const cells: RiskMapResponse["cells"] = [];
    let total = 0;
    let unscored = 0;
    let unplaced = 0;
    for (const row of rows) {
      const n = Number(row.n);
      total += n;
      if (row.likelihood !== null && row.impact !== null)
        cells.push({ likelihood: row.likelihood, impact: row.impact, count: n });
      else if (row.unscored) unscored += n;
      else unplaced += n;
    }
    return { basis, appetiteThreshold, cells, total, unscored, unplaced };
  }

  /**
   * Reports, approvals and closings (marked as treated) per UTC week over the 12 weeks ending
   * with `until`'s week, oldest first, zeros included: the home page passes now.
   */
  async movement(actor: Actor, until: Date): Promise<MovementWeek[]> {
    return this.movementCounts(actor, recentWeekStarts(until, MOVEMENT_WEEKS), until);
  }

  /**
   * Reports, approvals and closings per week of `weekStarts` (consecutive Mondays, oldest
   * first), counting events from the first week start up to (not including) `until`. Weeks start
   * on Monday 00:00 UTC. Closings come from the version history (each version that changed the
   * state to closed), so a risk closed and later reassessed still counts in the week it was closed.
   */
  async movementCounts(
    actor: Actor,
    weekStarts: readonly string[],
    until: Date,
  ): Promise<MovementWeek[]> {
    const from = new Date(`${weekStarts[0] ?? ""}T00:00:00Z`);
    const visible = riskVisibilitySql(actor);
    const [reported, approved, closed] = await Promise.all([
      this.prisma.$queryRaw<{ week: string; n: bigint }[]>`
        SELECT to_char(date_trunc('week', r."createdAt" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS week,
               count(*) AS n
        FROM "Risk" r
        WHERE ${visible} AND r."createdAt" >= ${from}::timestamptz
          AND r."createdAt" < ${until}::timestamptz
        GROUP BY 1`,
      this.prisma.$queryRaw<{ week: string; n: bigint }[]>`
        SELECT to_char(date_trunc('week', a."createdAt" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS week,
               count(*) AS n
        FROM "Approval" a JOIN "Risk" r ON r.id = a."riskId"
        WHERE ${visible} AND a.decision = 'approved' AND a."createdAt" >= ${from}::timestamptz
          AND a."createdAt" < ${until}::timestamptz
        GROUP BY 1`,
      this.prisma.$queryRaw<{ week: string; n: bigint }[]>`
        SELECT to_char(date_trunc('week', v."createdAt" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS week,
               count(*) AS n
        FROM "RiskVersion" v JOIN "Risk" r ON r.id = v."riskId"
        WHERE ${visible} AND 'state' = ANY(v."changedFields")
          AND v.snapshot->>'state' = 'closed' AND v."createdAt" >= ${from}::timestamptz
          AND v."createdAt" < ${until}::timestamptz
        GROUP BY 1`,
    ]);
    const count = (rows: { week: string; n: bigint }[], week: string) =>
      Number(rows.find((r) => r.week === week)?.n ?? 0);
    return weekStarts.map((weekStart) => ({
      weekStart,
      reported: count(reported, weekStart),
      approved: count(approved, weekStart),
      closed: count(closed, weekStart),
    }));
  }
}
