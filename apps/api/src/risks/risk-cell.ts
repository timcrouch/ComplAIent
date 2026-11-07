import type { RiskListQuery } from "@isms/contracts";
import { Prisma } from "@isms/database";

/**
 * The residual map position as SQL on the alias `r` of "Risk". It must match `mapPosition` in
 * @isms/domain: an accepted risk sits at its inherent position (P5-R2), any other at its residual.
 */
export const MAP_LIKELIHOOD_RESIDUAL_SQL = Prisma.sql`CASE WHEN r.treatment = 'accept' THEN r.likelihood ELSE r."residualLikelihood" END`;
export const MAP_IMPACT_RESIDUAL_SQL = Prisma.sql`CASE WHEN r.treatment = 'accept' THEN r.impact ELSE r."residualImpact" END`;

const NO_EXPECTED_SCORE_BASE: Prisma.RiskWhereInput = {
  likelihood: { not: null },
  impact: { not: null },
  OR: [{ treatment: { not: "accept" } }, { treatment: null }],
  AND: [{ OR: [{ residualLikelihood: null }, { residualImpact: null }] }],
};

/**
 * Risks the Expected map cannot place: the null branch of `mapPosition`
 * (packages/domain/src/residual.ts:32), counted as `unplaced` by RiskInsightsService.map. They are
 * scored inherently (otherwise they are `unscored`), not accepted (null treatment counts as not
 * accepted), and lack a residual likelihood or impact. Closed risks count only with
 * `includeClosed`, exactly as the map counts them (Ruling R9).
 */
export function noExpectedScoreWhere(includeClosed = false): Prisma.RiskWhereInput {
  return {
    ...(includeClosed ? {} : { state: { not: "closed" } }),
    ...NO_EXPECTED_SCORE_BASE,
  };
}

export type Cell = Pick<RiskListQuery, "likelihood" | "impact" | "basis" | "includeClosed">;

/** The list's likelihood × impact cell as a Prisma condition, or null when no cell is asked for. */
export function cellWhere(q: Cell): Prisma.RiskWhereInput | null {
  const { likelihood, impact } = q;
  if (likelihood === undefined || impact === undefined) return null;
  // Like the map, a cell leaves closed risks out unless asked (P6-R3).
  const open: Prisma.RiskWhereInput = q.includeClosed ? {} : { state: { not: "closed" } };
  if (q.basis === "inherent") return { ...open, likelihood, impact };
  return {
    ...open,
    OR: [
      { treatment: "accept", likelihood, impact },
      {
        OR: [{ treatment: { not: "accept" } }, { treatment: null }],
        residualLikelihood: likelihood,
        residualImpact: impact,
      },
    ],
  };
}

/** The same cell as `cellWhere`, as SQL on the alias `r` of "Risk" (TRUE when no cell is asked for). */
export function cellSql(q: Cell): Prisma.Sql {
  const { likelihood, impact } = q;
  if (likelihood === undefined || impact === undefined) return Prisma.sql`TRUE`;
  const open = q.includeClosed ? Prisma.sql`TRUE` : Prisma.sql`r.state <> 'closed'`;
  if (q.basis === "inherent")
    return Prisma.sql`(${open} AND r.likelihood = ${likelihood} AND r.impact = ${impact})`;
  return Prisma.sql`(${open} AND ${MAP_LIKELIHOOD_RESIDUAL_SQL} = ${likelihood} AND ${MAP_IMPACT_RESIDUAL_SQL} = ${impact})`;
}
