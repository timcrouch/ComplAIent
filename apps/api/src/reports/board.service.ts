import { Inject, Injectable } from "@nestjs/common";
import type {
  BoardFactsDto,
  BoardMovementWeekDto,
  BoardPackResponse,
  BoardQuery,
  BoardTopRiskDto,
} from "@isms/contracts";
import { Prisma } from "@isms/database";
import {
  type BoardPeriod,
  type Clock,
  DomainError,
  boardPeriodByKey,
  boardPeriods,
  defaultBoardPeriod,
  formatRiskReference,
  mapPosition,
  previousBoardPeriod,
  riskScore,
  weekStartsEnding,
} from "@isms/domain";
import { AiGatewayService } from "../ai/index.js";
import { PolicyService } from "../authorization/index.js";
import { type Actor, CLOCK } from "../identity/index.js";
import { RiskScaleService } from "../organisation/index.js";
import { PRISMA, type PrismaService } from "../platform/index.js";
import {
  RiskInsightsService,
  RiskQueryService,
  isoDate,
  overdueTaskWhere,
  riskVisibilitySql,
  riskVisibilityWhere,
} from "../risks/index.js";
import { boardTiles } from "./board-tiles.js";
import { countsAt, openAt } from "./history.js";
import { ownerRows } from "./owners.js";
import { ReportsService } from "./reports.service.js";

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const TOP_RISKS = 5;
const MOVEMENT_WEEKS = 12;

/** A period's bounds: from its first day 00:00Z up to (not including) the day after its end. */
const bounds = (p: BoardPeriod) => ({
  from: new Date(`${p.start}T00:00:00.000Z`),
  until: new Date(new Date(`${p.end}T00:00:00.000Z`).getTime() + DAY_MS),
});

type PeriodCounts = Pick<BoardFactsDto, "reported" | "approved" | "closed">;

const TOP_RISK_SELECT = {
  id: true,
  reference: true,
  title: true,
  likelihood: true,
  impact: true,
  residualLikelihood: true,
  residualImpact: true,
  treatment: true,
  owner: { select: { displayName: true } },
} as const satisfies Prisma.RiskSelect;
type TopRiskRow = Prisma.RiskGetPayload<{ select: typeof TOP_RISK_SELECT }>;

/** The inherent score of a risk the above-appetite filter matched (it is always scored). */
const scoreOf = (r: TopRiskRow) => riskScore(r.likelihood ?? 0, r.impact ?? 0);

/** The board pack (§5.4): one period's facts, top risks, maps, movement and narrative. */
@Injectable()
export class BoardService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly policy: PolicyService,
    private readonly scale: RiskScaleService,
    private readonly risks: RiskQueryService,
    private readonly insights: RiskInsightsService,
    private readonly ai: AiGatewayService,
    private readonly reports: ReportsService,
  ) {}

  /** The pack for `query.period` (default: the last full month); an unknown key is a 400. */
  async get(actor: Actor, query: BoardQuery): Promise<BoardPackResponse> {
    const now = this.clock.now();
    const period = this.period(query.period, now);
    const { appetiteThreshold } = await this.scale.currentAppetite();
    const aboveAppetite = await this.aboveAppetite(actor, appetiteThreshold);
    // P7-R8: a narrative speaks for the whole organisation, so only organisation-wide readers
    // see, draft or approve one; a scoped reader gets none.
    const orgWide = this.policy.accessScope(actor, "reports.read").kind === "organisation";
    const mayNarrate = orgWide && this.policy.can(actor, "reports.narrative");
    const previous = previousBoardPeriod(period);
    const { from, until } = bounds(period);
    const [
      header,
      facts,
      topRisks,
      mapNow,
      mapExpected,
      narrative,
      aiReady,
      before,
      atStart,
      movement,
      owners,
    ] = await Promise.all([
      this.reports.header(actor, now),
      this.facts(actor, period, now, appetiteThreshold, aboveAppetite.length),
      this.topRisks(aboveAppetite),
      this.insights.map(actor, "inherent"),
      this.insights.map(actor, "residual"),
      orgWide ? this.narrative(period) : Promise.resolve(null),
      mayNarrate ? this.ai.readiness("posture_summary") : Promise.resolve({ ready: false }),
      this.periodCounts(actor, previous),
      countsAt(this.prisma, actor, from, appetiteThreshold),
      this.movement(actor, period, now),
      ownerRows(this.prisma, actor, from, until, isoDate(now)),
    ]);
    return {
      ...header,
      period,
      periods: boardPeriods(now),
      facts,
      tiles: boardTiles(
        facts,
        { period: previous, counts: before },
        { since: period.start, ...atStart },
      ),
      topRisks,
      mapNow,
      mapExpected,
      movement,
      owners,
      narrative,
      canDraftNarrative: mayNarrate && aiReady.ready,
      canApproveNarrative: mayNarrate,
    };
  }

  /** The period for `key` (default: the last full month); an unknown key is a 400 at `period`. */
  period(key: string | undefined, now: Date = this.clock.now()): BoardPeriod {
    const period = key === undefined ? defaultBoardPeriod(now) : boardPeriodByKey(now, key);
    if (period === null)
      throw new DomainError("VALIDATION_FAILED", "Request validation failed", [
        { path: "period", message: "Unknown period" },
      ]);
    return period;
  }

  /**
   * The facts and top risks of a period over the risks the actor may see: what a board
   * narrative is written from and checked against.
   */
  async factsAndTopRisks(
    actor: Actor,
    period: BoardPeriod,
  ): Promise<{ facts: BoardFactsDto; topRisks: BoardTopRiskDto[] }> {
    const now = this.clock.now();
    const { appetiteThreshold } = await this.scale.currentAppetite();
    const aboveAppetite = await this.aboveAppetite(actor, appetiteThreshold);
    const [facts, topRisks] = await Promise.all([
      this.facts(actor, period, now, appetiteThreshold, aboveAppetite.length),
      this.topRisks(aboveAppetite),
    ]);
    return { facts, topRisks };
  }

  /**
   * The headline facts, all over the risks the actor may see:
   * - `openRisks`: current risks that are not closed;
   * - `aboveAppetite`: current open risks whose inherent score is above the current threshold
   *   (the list's `aboveAppetite` filter);
   * - `reported`: risks created within the period;
   * - `approved`: approval decisions ("approved") made within the period (a risk approved twice
   *   counts twice, as in the movement chart);
   * - `closed`: risks with a version that changed the state to closed within the period, each
   *   risk once (P8-R5), so a risk closed and later reassessed still counts, and one closed twice
   *   counts once;
   * - `overdueActions`: open treatment actions due before today (UTC), whatever the risk's state;
   * - `reviewsDue`: approved or closed risks whose next review is due today or earlier (the
   *   list's `reviewDue` filter).
   * Period bounds are whole UTC days, the end day included.
   */
  private async facts(
    actor: Actor,
    period: BoardPeriod,
    now: Date,
    appetiteThreshold: number,
    aboveAppetite: number,
  ): Promise<BoardFactsDto> {
    const reviewDue = this.risks.filterWhere(actor, "reviewDue", appetiteThreshold);
    const [[open], counts, overdueActions, reviewsDue] = await Promise.all([
      this.prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM "Risk" r WHERE ${riskVisibilitySql(actor)} AND r.state <> 'closed'`,
      this.periodCounts(actor, period),
      this.prisma.task.count({
        where: {
          ...overdueTaskWhere(isoDate(now)),
          kind: "treatment_action",
          risk: riskVisibilityWhere(actor),
        },
      }),
      reviewDue === null
        ? Promise.resolve(0)
        : this.prisma.risk.count({ where: { AND: [riskVisibilityWhere(actor), reviewDue] } }),
    ]);
    return {
      openRisks: Number(open?.n ?? 0),
      aboveAppetite,
      ...counts,
      overdueActions,
      reviewsDue,
    };
  }

  /** The period facts `reported`, `approved` and `closed` (see `facts`) for any period. */
  private async periodCounts(actor: Actor, period: BoardPeriod): Promise<PeriodCounts> {
    const visible = riskVisibilitySql(actor);
    const { from, until } = bounds(period);
    const [counts] = await this.prisma.$queryRaw<
      { reported: bigint; approved: bigint; closed: bigint }[]
    >`
      SELECT
        (SELECT count(*) FROM "Risk" r WHERE ${visible}
           AND r."createdAt" >= ${from}::timestamptz AND r."createdAt" < ${until}::timestamptz) AS reported,
        (SELECT count(*) FROM "Approval" a JOIN "Risk" r ON r.id = a."riskId"
         WHERE ${visible} AND a.decision = 'approved'
           AND a."createdAt" >= ${from}::timestamptz AND a."createdAt" < ${until}::timestamptz) AS approved,
        (SELECT count(DISTINCT v."riskId") FROM "RiskVersion" v JOIN "Risk" r ON r.id = v."riskId"
         WHERE ${visible} AND 'state' = ANY(v."changedFields") AND v.snapshot->>'state' = 'closed'
           AND v."createdAt" >= ${from}::timestamptz AND v."createdAt" < ${until}::timestamptz) AS closed`;
    return {
      reported: Number(counts?.reported ?? 0),
      approved: Number(counts?.approved ?? 0),
      closed: Number(counts?.closed ?? 0),
    };
  }

  /**
   * The 12 weeks ending with the period's end (spec §4.3). Each week counts events in
   * [weekStart, min(weekStart + 7 days, period end, now)); `openAtEnd` is the version-history open count at
   * that same instant, for every week including the current one (P8-R3: never `Risk.state`).
   */
  private async movement(
    actor: Actor,
    period: BoardPeriod,
    now: Date,
  ): Promise<BoardMovementWeekDto[]> {
    const weeks = weekStartsEnding(period.end, MOVEMENT_WEEKS);
    const periodUntil = Date.parse(`${period.end}T00:00:00Z`) + DAY_MS; // end is inclusive
    const ends = weeks.map(
      (w) => new Date(Math.min(Date.parse(`${w}T00:00:00Z`) + WEEK_MS, periodUntil, now.getTime())),
    );
    const until = ends[ends.length - 1] ?? now;
    const [counts, open] = await Promise.all([
      this.insights.movementCounts(actor, weeks, until),
      openAt(this.prisma, actor, ends),
    ]);
    return counts.map((week, i) => ({ ...week, openAtEnd: open[i] ?? 0 }));
  }

  /** Visible open risks above appetite (the list's filter), by inherent score desc, then reference. */
  private async aboveAppetite(actor: Actor, appetiteThreshold: number): Promise<TopRiskRow[]> {
    const filter = this.risks.filterWhere(actor, "aboveAppetite", appetiteThreshold);
    if (filter === null) return [];
    const rows = await this.prisma.risk.findMany({
      where: { AND: [riskVisibilityWhere(actor), filter] },
      select: TOP_RISK_SELECT,
    });
    return rows.sort((a, b) => scoreOf(b) - scoreOf(a) || a.reference - b.reference);
  }

  /**
   * The first five above-appetite risks, with the expected score (residual map position,
   * P5-R2) and action progress: done of all treatment actions not cancelled.
   */
  private async topRisks(sorted: TopRiskRow[]): Promise<BoardTopRiskDto[]> {
    const top = sorted.slice(0, TOP_RISKS);
    if (top.length === 0) return [];
    const groups = await this.prisma.task.groupBy({
      by: ["riskId", "status"],
      where: {
        kind: "treatment_action",
        status: { in: ["open", "done"] },
        riskId: { in: top.map((r) => r.id) },
      },
      _count: { _all: true },
    });
    const tally = (riskId: string, status?: "done") =>
      groups
        .filter((g) => g.riskId === riskId && (status === undefined || g.status === status))
        .reduce((sum, g) => sum + g._count._all, 0);
    return top.map((r) => {
      const residual = mapPosition(r, "residual");
      return {
        reference: formatRiskReference(r.reference),
        title: r.title,
        owner: r.owner?.displayName ?? null,
        treatment: r.treatment,
        score: scoreOf(r),
        residualScore: residual === null ? null : riskScore(residual.likelihood, residual.impact),
        actions: { done: tally(r.id, "done"), total: tally(r.id) },
      };
    });
  }

  /**
   * The newest approved narrative for the period; later approvals replace earlier ones. It must
   * match the key and both dates (P7-R12): a rolling period such as "last-30-days" keeps its key
   * as its days move, and a summary of other days must never be shown for it.
   */
  private async narrative(period: BoardPeriod): Promise<BoardPackResponse["narrative"]> {
    const row = await this.prisma.boardNarrative.findFirst({
      where: {
        periodKey: period.key,
        periodStart: new Date(`${period.start}T00:00:00.000Z`),
        periodEnd: new Date(`${period.end}T00:00:00.000Z`),
      },
      orderBy: [{ approvedAt: "desc" }, { id: "desc" }],
      select: {
        text: true,
        approvedAt: true,
        aiInteractionId: true,
        approvedBy: { select: { displayName: true } },
      },
    });
    return row === null
      ? null
      : {
          text: row.text,
          approvedBy: row.approvedBy.displayName,
          approvedAt: row.approvedAt.toISOString(),
          aiAssisted: row.aiInteractionId !== null,
        };
  }
}
