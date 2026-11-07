import { Inject, Injectable } from "@nestjs/common";
import type {
  RiskPictureDto,
  WorkspaceDimensionsDto,
  WorkspaceResponse,
  WorkspaceStatementDto,
  WorkspaceStatementKey,
} from "@isms/contracts";
import type { Prisma } from "@isms/database";
import { DEFAULT_REVIEW_INTERVAL_MONTHS, formatRiskReference } from "@isms/domain";
import { PolicyService } from "../authorization/index.js";
import type { Actor } from "../identity/index.js";
import { RiskScaleService } from "../organisation/index.js";
import { PRISMA, type PrismaService } from "../platform/index.js";
import {
  CONTROL_HAS_EVIDENCE_SQL,
  isOverdue,
  isoDate,
  overdueTaskWhere,
  RiskInsightsService,
  RiskQueryService,
  riskVisibilitySql,
  riskVisibilityWhere,
  taskRiskFields,
  visibleRiskIds,
} from "../risks/index.js";

const LIST_LIMIT = 5;
const CONCERN_UPDATE_DAYS = 14;
const DAY_MS = 24 * 3600 * 1000;

const HREF: Readonly<Record<WorkspaceStatementKey, string>> = {
  approvalsWaiting: "/risks?filter=awaitingMyApproval",
  toReview: "/risks?filter=toReview",
  aboveAppetite: "/risks?filter=aboveAppetite",
  evidenceMissing: "/risks?filter=evidenceMissing",
  tasksOpen: "/tasks",
  actionsOverdue: "/tasks",
  reviewsDue: "/risks?filter=reviewDue",
  concernsUpdated: "/concerns",
};

/** Risk-list counts; only for a viewer who may open the risk list (risks.read). */
type RiskCounts = {
  approvalsWaiting: number;
  toReview: number;
  aboveAppetite: number;
  evidenceMissing: number;
  reviewsDue: number;
};

/**
 * The home workspace. Every risk count is over the viewer's visible risks and uses the risk
 * list's own filter conditions, so a statement's count is what its link lists. All counts are
 * aggregate queries; the two lists are capped at five rows.
 */
@Injectable()
export class WorkspaceService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly risks: RiskQueryService,
    private readonly scale: RiskScaleService,
    private readonly insights: RiskInsightsService,
  ) {}

  async get(actor: Actor): Promise<WorkspaceResponse> {
    const now = new Date();
    const today = isoDate(now);
    const readsRisks = this.policy.canAtAnyScope(actor, "risks.read");
    const [
      riskCounts,
      riskPicture,
      tasksOpen,
      actionsOverdue,
      concernsUpdated,
      myConcerns,
      myTasks,
    ] = await Promise.all([
      readsRisks ? this.riskCounts(actor) : null,
      readsRisks ? this.riskPicture(actor, now) : null,
      this.prisma.task.count({
        where: { assigneeId: actor.userId, status: "open" },
      }),
      this.prisma.task.count({
        where: {
          AND: [{ assigneeId: actor.userId, kind: "treatment_action" }, overdueTaskWhere(today)],
        },
      }),
      this.prisma.risk.count({
        where: {
          reporterId: actor.userId,
          state: { not: "proposed" },
          updatedAt: {
            gte: new Date(now.getTime() - CONCERN_UPDATE_DAYS * DAY_MS),
          },
        },
      }),
      this.prisma.risk.findMany({
        where: { reporterId: actor.userId },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: LIST_LIMIT,
        select: {
          id: true,
          reference: true,
          title: true,
          state: true,
          updatedAt: true,
        },
      }),
      this.prisma.task.findMany({
        where: { assigneeId: actor.userId, status: "open" },
        // The order of the viewer's task list (TasksService.myTasks).
        orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }],
        take: LIST_LIMIT,
        select: {
          id: true,
          kind: true,
          title: true,
          dueDate: true,
          status: true,
          riskId: true,
          risk: { select: { reference: true, title: true } },
        },
      }),
    ]);
    const visibleTaskRisks = await visibleRiskIds(
      this.prisma,
      this.policy,
      actor,
      myTasks.map((t) => t.riskId),
    );

    const counts: Record<WorkspaceStatementKey, number> = {
      approvalsWaiting: riskCounts?.approvalsWaiting ?? 0,
      toReview: riskCounts?.toReview ?? 0,
      aboveAppetite: riskCounts?.aboveAppetite ?? 0,
      evidenceMissing: riskCounts?.evidenceMissing ?? 0,
      tasksOpen,
      actionsOverdue,
      reviewsDue: riskCounts?.reviewsDue ?? 0,
      concernsUpdated,
    };
    const statements: WorkspaceStatementDto[] = (
      Object.keys(HREF) as WorkspaceStatementKey[]
    ).flatMap((key) => (counts[key] > 0 ? [{ key, count: counts[key], href: HREF[key] }] : []));

    return {
      statements,
      dimensions: riskCounts ? await this.dimensions(actor, riskCounts, today) : null,
      riskPicture,
      myConcerns: myConcerns.map((r) => ({
        id: r.id,
        reference: formatRiskReference(r.reference),
        title: r.title,
        state: r.state,
        updatedAt: r.updatedAt.toISOString(),
      })),
      myTasks: myTasks.map((t) => {
        const dueDate = t.dueDate === null ? null : isoDate(t.dueDate);
        return {
          id: t.id,
          kind: t.kind,
          title: t.title,
          ...taskRiskFields(t.kind, t.riskId, t.risk, visibleTaskRisks),
          dueDate,
          overdue: isOverdue(t.status, dueDate, today),
        };
      }),
    };
  }

  private async riskPicture(actor: Actor, now: Date): Promise<RiskPictureDto> {
    const [map, movement] = await Promise.all([
      this.insights.map(actor, "inherent"),
      this.insights.movement(actor, now),
    ]);
    return { map, movement };
  }

  /** The risk list's filters, counted over the viewer's visible risks. */
  private async riskCounts(actor: Actor): Promise<RiskCounts> {
    const { appetiteThreshold } = await this.scale.currentAppetite();
    const count = (filter: "awaitingMyApproval" | "toReview" | "aboveAppetite" | "reviewDue") => {
      const where = this.risks.filterWhere(actor, filter, appetiteThreshold);
      return where === null
        ? 0
        : this.prisma.risk.count({
            where: { AND: [riskVisibilityWhere(actor), where] },
          });
    };
    const [approvalsWaiting, toReview, aboveAppetite, evidenceMissing, reviewsDue] =
      await Promise.all([
        count("awaitingMyApproval"),
        count("toReview"),
        count("aboveAppetite"),
        this.risks.countEvidenceMissing(actor),
        count("reviewDue"),
      ]);
    return { approvalsWaiting, toReview, aboveAppetite, evidenceMissing, reviewsDue };
  }

  private async dimensions(
    actor: Actor,
    counts: RiskCounts,
    today: string,
  ): Promise<WorkspaceDimensionsDto> {
    const visible = riskVisibilityWhere(actor);
    const onVisible: Prisma.TaskWhereInput = { risk: visible };
    const org = await this.prisma.organisation.findFirst({
      select: { reviewIntervalMonths: true },
    });
    const months = org?.reviewIntervalMonths ?? DEFAULT_REVIEW_INTERVAL_MONTHS;
    const [byState, controls, evidenceItems, tasksOpen, tasksOverdue] = await Promise.all([
      this.prisma.risk.groupBy({
        by: ["state"],
        where: visible,
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<{ accepted: bigint; withEvidence: bigint; tested: bigint }[]>`
        SELECT count(*) AS accepted,
               count(*) FILTER (WHERE ${CONTROL_HAS_EVIDENCE_SQL}) AS "withEvidence",
               count(*) FILTER (WHERE EXISTS (
                 SELECT 1 FROM "ControlTest" t
                 WHERE t."controlId" = rc."controlId"
                   AND t."testedOn" + make_interval(months => ${months}::int) > ${today}::date)) AS tested
        FROM "RiskControl" rc JOIN "Risk" r ON r.id = rc."riskId"
        WHERE rc.status = 'accepted' AND ${riskVisibilitySql(actor)}`,
      this.prisma.evidence.count({ where: { risk: visible } }),
      this.prisma.task.count({
        where: { AND: [{ status: "open" }, onVisible] },
      }),
      this.prisma.task.count({
        where: { AND: [overdueTaskWhere(today), onVisible] },
      }),
    ]);
    const inState = (state: string) => byState.find((g) => g.state === state)?._count._all ?? 0;
    const [c] = controls;
    return {
      risks: {
        total: byState.reduce((sum, g) => sum + g._count._all, 0),
        aboveAppetite: counts.aboveAppetite,
        proposed: inState("proposed"),
        inReview: inState("in_review"),
        approved: inState("approved"),
        returned: inState("returned"),
        closed: inState("closed"),
      },
      controls: {
        accepted: Number(c?.accepted ?? 0),
        withEvidence: Number(c?.withEvidence ?? 0),
        testedWithinInterval: Number(c?.tested ?? 0),
      },
      evidence: { items: evidenceItems, missing: counts.evidenceMissing },
      tasks: { open: tasksOpen, overdue: tasksOverdue },
    };
  }
}
