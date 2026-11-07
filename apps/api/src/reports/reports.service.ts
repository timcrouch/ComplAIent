import { Inject, Injectable } from "@nestjs/common";
import {
  type RegisterQuery,
  type RegisterResponse,
  type RegisterRowDto,
  type ReportScopeDto,
  conflictDetail,
} from "@isms/contracts";
import { Prisma } from "@isms/database";
import {
  type Clock,
  DomainError,
  formatRiskReference,
  isAboveAppetite,
  isoDateUtc,
  mapPosition,
  riskScore,
} from "@isms/domain";
import { PolicyService } from "../authorization/index.js";
import { type Actor, CLOCK } from "../identity/index.js";
import { RiskScaleService } from "../organisation/index.js";
import { PRISMA, type PrismaService } from "../platform/index.js";
import {
  EVIDENCE_MISSING_SQL,
  RiskQueryService,
  isoDate,
  overdueTaskWhere,
  riskVisibilitySql,
  riskVisibilityWhere,
} from "../risks/index.js";

/** The most rows a register may hold; above it the report is refused (409 reportTooLarge). */
export const REGISTER_CAP = 5000;

/**
 * The most rows a register PDF may hold (P7-R10): pdfmake lays a document out synchronously,
 * so the PDF is bounded tighter than the JSON and Excel register.
 */
export const REGISTER_PDF_CAP = 1000;

/** What every report carries on its cover (§5.1, global constraints "Files"). */
export type ReportHeader = {
  generatedAt: string;
  generatedBy: string;
  organisation: string;
  scope: ReportScopeDto;
};

const REGISTER_SELECT = {
  id: true,
  reference: true,
  title: true,
  state: true,
  likelihood: true,
  impact: true,
  residualLikelihood: true,
  residualImpact: true,
  treatment: true,
  nextReviewDue: true,
  closedAt: true,
  owner: { select: { displayName: true } },
  site: { select: { name: true } },
  department: { select: { name: true } },
  controls: {
    where: { status: "accepted" },
    select: { control: { select: { code: true } } },
    orderBy: { control: { code: "asc" } },
  },
  approvals: {
    where: { decision: "approved" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 1,
    select: { createdAt: true, approver: { select: { displayName: true } } },
  },
} as const satisfies Prisma.RiskSelect;
type RegisterRow = Prisma.RiskGetPayload<{ select: typeof REGISTER_SELECT }>;

const byName = (a: string, b: string) => a.localeCompare(b);

/** The cover data shared by every report, and the risk register (§5.2). */
@Injectable()
export class ReportsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly policy: PolicyService,
    private readonly scale: RiskScaleService,
    private readonly risks: RiskQueryService,
  ) {}

  /**
   * Whose risks the report covers, from the actor's `reports.read` assignments (the
   * `PolicyService.accessScope` rule): the organisation, or the names of the sites (then the
   * departments), each sorted by name. The figures themselves follow risk visibility.
   */
  async scope(actor: Actor): Promise<ReportScopeDto> {
    const scope = this.policy.accessScope(actor, "reports.read");
    if (scope.kind === "organisation") return { kind: "organisation" };
    if (scope.kind === "none") return { kind: "units", names: [] };
    const [sites, departments] = await Promise.all([
      this.prisma.site.findMany({ where: { id: { in: scope.siteIds } }, select: { name: true } }),
      this.prisma.department.findMany({
        where: { id: { in: scope.departmentIds } },
        select: { name: true },
      }),
    ]);
    return {
      kind: "units",
      names: [
        ...sites.map((s) => s.name).sort(byName),
        ...departments.map((d) => d.name).sort(byName),
      ],
    };
  }

  /** Generated when, for whom (display name), for which organisation, over which scope. */
  async header(actor: Actor, now: Date): Promise<ReportHeader> {
    const [user, organisation, scope] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: actor.userId }, select: { displayName: true } }),
      this.prisma.organisation.findFirst({ select: { name: true } }),
      this.scope(actor),
    ]);
    return {
      generatedAt: now.toISOString(),
      generatedBy: user?.displayName ?? actor.email,
      organisation: organisation?.name ?? "",
      scope,
    };
  }

  /**
   * The risk register: every visible risk the list's filter matches (the list's own
   * where-builder, so the two cannot disagree), in reference order, without paging. More than
   * `cap` rows (`REGISTER_CAP`, or `REGISTER_PDF_CAP` for a PDF) is refused with 409
   * `reportTooLarge` rather than truncated silently.
   */
  async register(
    actor: Actor,
    query: RegisterQuery,
    cap: number = REGISTER_CAP,
  ): Promise<RegisterResponse> {
    const now = this.clock.now();
    const { appetiteThreshold } = await this.scale.currentAppetite();
    const where = await this.registerWhere(actor, query, appetiteThreshold, cap);
    let rows: RegisterRow[] = [];
    if (where !== null) {
      if ((await this.prisma.risk.count({ where })) > cap) throw tooLarge();
      rows = await this.prisma.risk.findMany({
        where,
        orderBy: { reference: "asc" },
        select: REGISTER_SELECT,
      });
    }
    const today = isoDate(now);
    const ids = rows.map((r) => r.id);
    const [open, overdue] = await Promise.all([
      this.actionCounts(ids, { status: "open" }),
      this.actionCounts(ids, overdueTaskWhere(today)),
    ]);
    return {
      ...(await this.header(actor, now)),
      appetiteThreshold,
      filter: query.filter,
      includeClosed: query.includeClosed,
      rows: rows.map((r) => toRegisterRow(r, appetiteThreshold, open, overdue)),
    };
  }

  /** The register's condition, or null when the filter can match nothing for this actor. */
  private async registerWhere(
    actor: Actor,
    query: RegisterQuery,
    appetiteThreshold: number,
    cap: number,
  ): Promise<Prisma.RiskWhereInput | null> {
    if (query.filter === "evidenceMissing") {
      // P3-R13 cannot be a relation filter (the evidence must be on the same risk): ids first.
      const ids = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT r.id FROM "Risk" r
        WHERE ${riskVisibilitySql(actor)} AND ${EVIDENCE_MISSING_SQL}
          AND ${query.includeClosed ? Prisma.sql`TRUE` : Prisma.sql`r.state <> 'closed'`}
        LIMIT ${cap + 1}`;
      if (ids.length > cap) throw tooLarge();
      return { id: { in: ids.map((r) => r.id) } };
    }
    const filter = this.risks.filterWhere(
      actor,
      query.filter,
      appetiteThreshold,
      query.includeClosed,
    );
    return filter === null ? null : { AND: [riskVisibilityWhere(actor), filter] };
  }

  /** Treatment actions matching `where`, counted per risk. */
  private async actionCounts(
    riskIds: string[],
    where: Prisma.TaskWhereInput,
  ): Promise<Map<string, number>> {
    if (riskIds.length === 0) return new Map();
    const groups = await this.prisma.task.groupBy({
      by: ["riskId"],
      where: { ...where, kind: "treatment_action", riskId: { in: riskIds } },
      _count: { _all: true },
    });
    return new Map(groups.map((g) => [g.riskId, g._count._all]));
  }
}

const tooLarge = () =>
  new DomainError("CONFLICT", "The register is too large", [conflictDetail("reportTooLarge")]);

/**
 * One register line. Expected values are the residual map position (an accepted risk is
 * expected to stay at its inherent position, P5-R2). "Approved by and on" is the latest
 * approval, shown only while the risk is approved or closed (a reassessed risk awaits a new one).
 */
function toRegisterRow(
  r: RegisterRow,
  appetiteThreshold: number,
  open: Map<string, number>,
  overdue: Map<string, number>,
): RegisterRowDto {
  const score =
    r.likelihood === null || r.impact === null ? null : riskScore(r.likelihood, r.impact);
  const residual = mapPosition(r, "residual");
  const approval = r.state === "approved" || r.state === "closed" ? (r.approvals[0] ?? null) : null;
  return {
    reference: formatRiskReference(r.reference),
    title: r.title,
    owner: r.owner?.displayName ?? null,
    site: r.site?.name ?? null,
    department: r.department?.name ?? null,
    state: r.state,
    likelihood: r.likelihood,
    impact: r.impact,
    score,
    aboveAppetite: score === null ? null : isAboveAppetite(score, appetiteThreshold),
    treatment: r.treatment,
    residualLikelihood: residual?.likelihood ?? null,
    residualImpact: residual?.impact ?? null,
    residualScore: residual === null ? null : riskScore(residual.likelihood, residual.impact),
    controls: r.controls.map((c) => c.control.code),
    openActions: open.get(r.id) ?? 0,
    overdueActions: overdue.get(r.id) ?? 0,
    nextReviewDue: r.nextReviewDue === null ? null : isoDateUtc(r.nextReviewDue),
    approvedBy: approval?.approver.displayName ?? null,
    approvedOn: approval === null ? null : isoDateUtc(approval.createdAt),
    closedOn: r.closedAt === null ? null : isoDateUtc(r.closedAt),
  };
}
