import { Inject, Injectable } from "@nestjs/common";
import type {
  MyConcernsResponse,
  RiskDetailDto,
  RiskListFilter,
  RiskListQuery,
  RiskListResponse,
} from "@isms/contracts";
import { Prisma } from "@isms/database";
import {
  DomainError,
  formatRiskReference,
  isAboveAppetite,
  mayConfirmReview,
  mayPlanActions,
  nextState,
  riskScore,
} from "@isms/domain";
import { AiGatewayService } from "../ai/index.js";
import { isoDate } from "./task-due.js";
import { PolicyService } from "../authorization/index.js";
import type { Actor } from "../identity/index.js";
import { RiskScaleService } from "../organisation/index.js";
import { PRISMA, type PrismaService } from "../platform/index.js";
import {
  approvalReadiness,
  approvalRefusalFor,
  awaitingApprovalWhere,
  mayReturn,
} from "./approval-readiness.js";
import {
  LEVELS,
  RISK_DETAIL_SELECT,
  RISK_SUMMARY_SELECT,
  type RiskRow,
  type RiskSummaryRow,
  riskScope,
  toDetail,
  toSummary,
} from "./mappers.js";
import { buildJourney } from "./journey.js";
import { type Cell, cellSql, cellWhere, noExpectedScoreWhere } from "./risk-cell.js";
import { buildTreatmentPlan } from "./treatment-plan.js";
import { riskVisibilitySql, riskVisibilityWhere } from "./risk-visibility.js";
import { mayReadTranscript } from "./transcript-access.js";

type Db = Prisma.TransactionClient;
type Cursor = { updatedAt: Date; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MY_CONCERNS_LIMIT = 50;

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify([c.updatedAt.toISOString(), c.id])).toString("base64url");
}

/** The keyset position of a cursor; anything malformed is a 400 at `cursor`. */
function decodeCursor(raw: string): Cursor {
  const invalid = () =>
    new DomainError("VALIDATION_FAILED", "Request validation failed", [
      { path: "cursor", message: "Value has an invalid format" },
    ]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw invalid();
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) throw invalid();
  const [at, id] = parsed as unknown[];
  if (typeof at !== "string" || typeof id !== "string" || !UUID.test(id)) throw invalid();
  const updatedAt = new Date(at);
  if (Number.isNaN(updatedAt.getTime()) || updatedAt.toISOString() !== at) throw invalid();
  return { updatedAt, id };
}

/**
 * Every likelihood × impact pair above the threshold. The database cannot call the domain
 * rule, so the pairs are listed with `riskScore` and `isAboveAppetite` from `@isms/domain`,
 * the same functions the DTO's `aboveAppetite` uses; the two cannot disagree. The list filter
 * and the board's version-history counts both use this one list.
 */
export function aboveAppetitePairs(threshold: number): [number, number][] {
  const pairs: [number, number][] = [];
  for (const likelihood of LEVELS)
    for (const impact of LEVELS)
      if (isAboveAppetite(riskScore(likelihood, impact), threshold))
        pairs.push([likelihood, impact]);
  return pairs;
}

function aboveAppetiteWhere(threshold: number): Prisma.RiskWhereInput {
  return {
    OR: aboveAppetitePairs(threshold).map(([likelihood, impact]) => ({ likelihood, impact })),
  };
}

/**
 * P3-R13 as a SQL condition on the alias `r` of "Risk": the risk has an accepted control with no
 * evidence linked to that control on that risk. The one definition: the list filter and the
 * workspace counts both use it. `CONTROL_HAS_EVIDENCE_SQL` is its inner part, on the alias `rc` of
 * "RiskControl": evidence on risk `r` is linked to that control.
 */
export const CONTROL_HAS_EVIDENCE_SQL = Prisma.sql`EXISTS (
  SELECT 1 FROM "EvidenceControl" ec
  JOIN "Evidence" e ON e.id = ec."evidenceId"
  WHERE ec."controlId" = rc."controlId" AND e."riskId" = r.id)`;

/** Open (not closed) risks only, unless closed ones are asked for: as on the map (P6-R8). */
const OPEN_SQL = Prisma.sql`r.state <> 'closed'`;
const OPEN_WHERE: Prisma.RiskWhereInput = { state: { not: "closed" } };

export const EVIDENCE_MISSING_SQL = Prisma.sql`EXISTS (
  SELECT 1 FROM "RiskControl" rc
  WHERE rc."riskId" = r.id AND rc.status = 'accepted' AND NOT ${CONTROL_HAS_EVIDENCE_SQL})`;

/** Reads risks, only ever those the actor may see (§10). */
@Injectable()
export class RiskQueryService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly scale: RiskScaleService,
    private readonly ai: AiGatewayService,
  ) {}

  /** The risk if the actor may see it; otherwise 404, whether or not it exists. */
  async getVisible(actor: Actor, id: string, db: Db = this.prisma): Promise<RiskRow> {
    const row = await db.risk.findFirst({
      where: { AND: [{ id }, riskVisibilityWhere(actor)] },
      select: RISK_DETAIL_SELECT,
    });
    if (!row) throw new DomainError("NOT_FOUND", "Not found");
    return row;
  }

  async detail(actor: Actor, id: string, db: Db = this.prisma): Promise<RiskDetailDto> {
    const row = await this.getVisible(actor, id, db);
    const { appetiteThreshold } = await this.scale.currentAppetite(db);
    const readiness = await approvalReadiness(db, this.policy, actor, row, appetiteThreshold);
    const journey = await buildJourney(db, row, readiness);
    const can = this.can(actor, row, appetiteThreshold);
    // One count, asked only when the viewer could close the risk otherwise.
    if (can.close)
      can.close =
        (await db.task.count({
          where: { riskId: id, kind: "treatment_action", status: "open" },
        })) === 0;
    // Asked only of an editor: the same readiness the suggestion request checks.
    can.suggestControls = can.edit && (await this.ai.readiness("control_suggestion")).ready;
    const plan = await buildTreatmentPlan(db, id, isoDate(new Date()));
    return toDetail(row, appetiteThreshold, can, readiness?.approval ?? null, journey, plan);
  }

  /**
   * What the actor may do with a risk they can see, by the same rules the actions enforce.
   * Submitting is offered whatever the blockers, so the web can list them. `suggestControls`
   * also needs the AI's readiness, which `detail` adds.
   */
  can(actor: Actor, row: RiskRow, appetiteThreshold: number): RiskDetailDto["can"] {
    const reviewer = this.policy.can(actor, "risks.review", riskScope(row));
    const reviews = nextState(row.state, "submit") !== null && reviewer;
    const inReview = row.state === "in_review";
    return {
      edit: reviews,
      submit: reviews,
      approve: inReview && approvalRefusalFor(this.policy, actor, row, appetiteThreshold) === null,
      return: inReview && mayReturn(this.policy, actor, row, appetiteThreshold),
      // `detail` also requires that no treatment action is open.
      close: reviewer && nextState(row.state, "close") !== null,
      reassess: reviewer && nextState(row.state, "reassess") !== null,
      confirmReview: reviewer && mayConfirmReview(row.state),
      // Evidence is additive in any state (P3-R12).
      addEvidence: reviewer,
      planActions: reviewer && mayPlanActions(row.state, row.treatment),
      readTranscript: mayReadTranscript(this.policy, actor, {
        conversationReporterId: row.conversation?.reporterId ?? null,
        siteId: row.siteId,
        departmentId: row.departmentId,
        // Only a visible risk reaches here (getVisible).
        riskVisible: true,
      }),
      suggestControls: false,
    };
  }

  async list(actor: Actor, query: RiskListQuery): Promise<RiskListResponse> {
    const { appetiteThreshold } = await this.scale.currentAppetite();
    const cursor = query.cursor === undefined ? null : decodeCursor(query.cursor);
    let rows: RiskSummaryRow[];
    if (query.filter === "evidenceMissing") {
      rows = await this.evidenceMissing(actor, query, cursor, query.limit + 1);
    } else {
      const filter = this.filterWhere(actor, query.filter, appetiteThreshold, query.includeClosed);
      if (filter === null) return { items: [], nextCursor: null };
      const where: Prisma.RiskWhereInput[] = [riskVisibilityWhere(actor), filter];
      const cell = cellWhere(query);
      if (cell) where.push(cell);
      if (cursor)
        where.push({
          OR: [
            { updatedAt: { lt: cursor.updatedAt } },
            { updatedAt: cursor.updatedAt, id: { lt: cursor.id } },
          ],
        });
      rows = await this.prisma.risk.findMany({
        where: { AND: where },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: query.limit + 1,
        select: RISK_SUMMARY_SELECT,
      });
    }
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((r) => toSummary(r, appetiteThreshold)),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
    };
  }

  /**
   * P3-R13: visible risks with an accepted control that has no evidence linked to it on that
   * risk. One bounded keyset query (the relation filter cannot tie the evidence to the outer
   * risk), then the page's rows by id.
   */
  private async evidenceMissing(
    actor: Actor,
    cell: Cell,
    cursor: Cursor | null,
    take: number,
  ): Promise<RiskSummaryRow[]> {
    const after = cursor
      ? Prisma.sql`AND (r."updatedAt" < ${cursor.updatedAt}::timestamptz
          OR (r."updatedAt" = ${cursor.updatedAt}::timestamptz AND r.id < ${cursor.id}::uuid))`
      : Prisma.empty;
    const ids = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT r.id FROM "Risk" r
      WHERE ${riskVisibilitySql(actor)} ${after}
        AND ${EVIDENCE_MISSING_SQL} AND ${cellSql(cell)}
        AND ${cell.includeClosed ? Prisma.sql`TRUE` : OPEN_SQL}
      ORDER BY r."updatedAt" DESC, r.id DESC
      LIMIT ${take}`;
    if (ids.length === 0) return [];
    const rows = await this.prisma.risk.findMany({
      where: { id: { in: ids.map((r) => r.id) } },
      select: RISK_SUMMARY_SELECT,
    });
    return ids.flatMap((r) => rows.filter((row) => row.id === r.id));
  }

  /** How many visible open risks the `evidenceMissing` filter lists (P3-R13, P6-R8), in one query. */
  async countEvidenceMissing(actor: Actor): Promise<number> {
    const [row] = await this.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "Risk" r
      WHERE ${riskVisibilitySql(actor)} AND ${EVIDENCE_MISSING_SQL} AND ${OPEN_SQL}`;
    return Number(row?.n ?? 0);
  }

  /**
   * The filter's own condition, or null when it can match nothing for this actor. Callers add
   * `riskVisibilityWhere`; the workspace counts use this too, so counts and lists agree.
   * `aboveAppetite` (like `evidenceMissing`) counts open risks only unless `includeClosed`.
   */
  filterWhere(
    actor: Actor,
    filter: Exclude<RiskListFilter, "evidenceMissing">,
    appetiteThreshold: number,
    includeClosed = false,
  ): Prisma.RiskWhereInput | null {
    switch (filter) {
      case "all":
        return {};
      case "reportedByMe":
        return { reporterId: actor.userId };
      case "ownedByMe":
        return { ownerId: actor.userId };
      case "aboveAppetite":
        return includeClosed
          ? aboveAppetiteWhere(appetiteThreshold)
          : { AND: [aboveAppetiteWhere(appetiteThreshold), OPEN_WHERE] };
      case "noExpectedScore":
        return noExpectedScoreWhere(includeClosed);
      case "awaitingMyApproval":
        return awaitingApprovalWhere(this.policy, actor, appetiteThreshold);
      case "reviewDue":
        return {
          state: { in: ["approved", "closed"] },
          nextReviewDue: { lte: new Date(`${isoDate(new Date())}T00:00:00.000Z`) },
        };
      case "toReview": {
        const scope = this.policy.accessScope(actor, "risks.review");
        if (scope.kind === "none") return null;
        const states: Prisma.RiskWhereInput = {
          state: { in: ["proposed", "returned"] },
        };
        if (scope.kind === "organisation") return states;
        return {
          ...states,
          OR: [{ siteId: { in: scope.siteIds } }, { departmentId: { in: scope.departmentIds } }],
        };
      }
    }
  }

  /** The actor's own reports, newest first. */
  async myConcerns(actor: Actor): Promise<MyConcernsResponse> {
    const rows = await this.prisma.risk.findMany({
      where: { reporterId: actor.userId },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: MY_CONCERNS_LIMIT,
      select: {
        id: true,
        reference: true,
        title: true,
        state: true,
        updatedAt: true,
      },
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        reference: formatRiskReference(r.reference),
        title: r.title,
        state: r.state,
        updatedAt: r.updatedAt.toISOString(),
      })),
    };
  }
}
