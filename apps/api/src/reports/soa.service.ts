import { Inject, Injectable } from "@nestjs/common";
import type {
  SetApplicabilityInput,
  SoaFrameworkDto,
  SoaQuery,
  SoaResponse,
  SoaRowDto,
} from "@isms/contracts";
import type { Prisma } from "@isms/database";
import {
  type Clock,
  DomainError,
  type ImplementationStatus,
  applicabilityHint,
  formatRiskReference,
  implementationStatus,
} from "@isms/domain";
import { type AuditContext, AuditService } from "../audit/index.js";
import { PolicyService } from "../authorization/index.js";
import { type Actor, CLOCK } from "../identity/index.js";
import { PRISMA, type PrismaService } from "../platform/index.js";
import { riskVisibilityWhere } from "../risks/index.js";
import { ReportsService } from "./reports.service.js";
import { type GroupedRow, soaGroups, withOtherGroup } from "./soa-groups.js";

/** The framework the SoA opens on when none is asked for (control-library key). */
const DEFAULT_FRAMEWORK_KEY = "iso27001";

const REQUIREMENT_SELECT = {
  id: true,
  ref: true,
  title: true,
  fullText: true,
  group: {
    select: {
      key: true,
      title: true,
      sortOrder: true,
      parent: { select: { key: true, title: true, sortOrder: true } },
    },
  },
  applicability: {
    select: {
      applicable: true,
      justification: true,
      decidedAt: true,
      decidedBy: { select: { displayName: true } },
    },
  },
  mappings: {
    select: { control: { select: { id: true, code: true, title: true } } },
    orderBy: { control: { code: "asc" } },
  },
} as const satisfies Prisma.RequirementSelect;
type RequirementRow = Prisma.RequirementGetPayload<{ select: typeof REQUIREMENT_SELECT }>;

type ConfirmedFramework = SoaFrameworkDto & { versionId: string; frameworkKey: string };

const notFound = () => new DomainError("NOT_FOUND", "Not found");

/** What the audit keeps of a decision: never the justification's text, only its length. */
const decisionSnapshot = (d: { applicable: boolean; justification: string }) => ({
  applicable: d.applicable,
  justification: { length: d.justification.length },
});

/** The Statement of Applicability (§5.3, P7-R2, P7-R3). */
@Injectable()
export class SoaService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly reports: ReportsService,
  ) {}

  /**
   * The SoA of a confirmed framework version: the one asked for (404 unless confirmed), else
   * ISO 27001, else the first confirmed; with none confirmed, `framework` is null and there
   * are no rows.
   */
  async get(actor: Actor, query: SoaQuery): Promise<SoaResponse> {
    const frameworks = await this.confirmedFrameworks();
    let framework: ConfirmedFramework | null;
    if (query.framework !== undefined) {
      framework = frameworks.find((f) => f.key === query.framework) ?? null;
      if (framework === null) throw notFound();
    } else {
      framework =
        frameworks.find((f) => f.frameworkKey === DEFAULT_FRAMEWORK_KEY) ?? frameworks[0] ?? null;
    }
    const found =
      framework === null
        ? { rows: [], grouped: [] }
        : await this.rows(actor, { frameworkVersionId: framework.versionId });
    const { rows, groups } = withOtherGroup(found.rows, soaGroups(found.grouped));
    const dto = ({ key, name, versionLabel }: ConfirmedFramework): SoaFrameworkDto => ({
      key,
      name,
      versionLabel,
    });
    return {
      ...(await this.reports.header(actor, this.clock.now())),
      frameworks: frameworks.map(dto),
      framework: framework === null ? null : dto(framework),
      groups,
      rows,
      canManage: this.policy.can(actor, "soa.manage"),
    };
  }

  /**
   * Records whether a requirement applies (one row per requirement, replaced on change) and
   * audits `soa.applicability_set` with the decision before and after, justifications by
   * length only. Any requirement of the library may be decided; unknown ids are 404.
   */
  async setApplicability(
    actor: Actor,
    requirementId: string,
    input: SetApplicabilityInput,
    ctx: AuditContext,
  ): Promise<SoaRowDto> {
    await this.prisma.$transaction(async (tx) => {
      const requirement = await tx.requirement.findUnique({
        where: { id: requirementId },
        select: { id: true },
      });
      if (!requirement) throw notFound();
      const before = await tx.requirementApplicability.findUnique({
        where: { requirementId },
        select: { applicable: true, justification: true },
      });
      const decision = {
        applicable: input.applicable,
        justification: input.justification,
        decidedById: actor.userId,
        decidedAt: this.clock.now(),
      };
      await tx.requirementApplicability.upsert({
        where: { requirementId },
        create: { requirementId, ...decision },
        update: decision,
      });
      await this.audit.record(
        {
          action: "soa.applicability_set",
          objectType: "requirement",
          objectId: requirementId,
          before: before === null ? undefined : decisionSnapshot(before),
          after: decisionSnapshot(input),
        },
        ctx,
        tx,
      );
    });
    const {
      rows: [row],
    } = await this.rows(actor, { id: requirementId });
    if (!row) throw notFound();
    return row;
  }

  /** Confirmed framework versions, in the order they were confirmed. */
  private async confirmedFrameworks(): Promise<ConfirmedFramework[]> {
    const rows = await this.prisma.organisationFramework.findMany({
      where: { status: "confirmed" },
      orderBy: [{ confirmedAt: "asc" }, { frameworkVersion: { key: "asc" } }],
      select: {
        frameworkVersion: {
          select: {
            id: true,
            key: true,
            label: true,
            framework: { select: { key: true, name: true } },
          },
        },
      },
    });
    return rows.map(({ frameworkVersion: v }) => ({
      versionId: v.id,
      key: v.key,
      name: v.framework.name,
      versionLabel: v.label,
      frameworkKey: v.framework.key,
    }));
  }

  /**
   * SoA rows for the matching requirements, in library order. A control's status counts
   * accepted uses on any risk (implementation is organisation-wide, P7-R3); `riskRefs` and the
   * hint name only the risks the actor may see. Also each row's group, for the headings.
   */
  private async rows(
    actor: Actor,
    where: Prisma.RequirementWhereInput,
  ): Promise<{ rows: SoaRowDto[]; grouped: GroupedRow[] }> {
    const requirements = await this.prisma.requirement.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { ref: "asc" }],
      select: REQUIREMENT_SELECT,
    });
    const controlIds = [
      ...new Set(requirements.flatMap((r) => r.mappings.map((m) => m.control.id))),
    ];
    const uses = await this.acceptedUses(actor, controlIds);
    const statuses = await this.statuses(controlIds, uses);
    return {
      rows: requirements.map((r) => toRow(r, statuses, uses)),
      grouped: requirements.map((r) => ({ group: r.group, decided: r.applicability !== null })),
    };
  }

  /** Each control's implementation status: accepted uses on any risk, and its latest test. */
  private async statuses(
    controlIds: string[],
    uses: Map<string, Use[]>,
  ): Promise<Map<string, ImplementationStatus>> {
    if (controlIds.length === 0) return new Map();
    const latest = await this.prisma.controlTest.findMany({
      where: { controlId: { in: controlIds } },
      orderBy: [{ controlId: "asc" }, { testedOn: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      distinct: ["controlId"],
      select: { controlId: true, result: true },
    });
    const results = new Map(latest.map((t) => [t.controlId, t.result]));
    return new Map(
      controlIds.map((id) => [
        id,
        implementationStatus({
          acceptedOnRisks: uses.get(id)?.length ?? 0,
          latestResult: results.get(id) ?? null,
        }),
      ]),
    );
  }

  /**
   * Every accepted use of each control, on any risk, marked visible or not for the actor. The
   * reference of a hidden risk never leaves this service: rows only count them (P7-R9).
   */
  private async acceptedUses(actor: Actor, controlIds: string[]): Promise<Map<string, Use[]>> {
    if (controlIds.length === 0) return new Map();
    const rows = await this.prisma.riskControl.findMany({
      where: { controlId: { in: controlIds }, status: "accepted" },
      select: { controlId: true, riskId: true, risk: { select: { reference: true } } },
    });
    const visible = await this.prisma.risk.findMany({
      where: {
        AND: [{ id: { in: [...new Set(rows.map((r) => r.riskId))] } }, riskVisibilityWhere(actor)],
      },
      select: { id: true },
    });
    const seen = new Set(visible.map((r) => r.id));
    const out = new Map<string, Use[]>();
    for (const r of rows)
      out.set(r.controlId, [
        ...(out.get(r.controlId) ?? []),
        { riskId: r.riskId, reference: r.risk.reference, visible: seen.has(r.riskId) },
      ]);
    return out;
  }
}

/** One accepted use of a control on a risk. */
type Use = { riskId: string; reference: number; visible: boolean };

/**
 * One SoA row. `riskRefs` names the distinct visible risks using any mapped control; the hint
 * also counts the distinct risks the actor cannot see (P7-R9).
 */
function toRow(
  r: RequirementRow,
  statuses: Map<string, ImplementationStatus>,
  uses: Map<string, Use[]>,
): SoaRowDto {
  const all = r.mappings.flatMap((m) => uses.get(m.control.id) ?? []);
  const references = new Set(all.filter((u) => u.visible).map((u) => u.reference));
  const hiddenCount = new Set(all.filter((u) => !u.visible).map((u) => u.riskId)).size;
  const riskRefs = [...references].sort((a, b) => a - b).map(formatRiskReference);
  const a = r.applicability;
  return {
    requirementId: r.id,
    ref: r.ref,
    title: r.title,
    fullText: r.fullText,
    decision:
      a === null
        ? null
        : {
            applicable: a.applicable,
            justification: a.justification,
            decidedBy: a.decidedBy.displayName,
            decidedAt: a.decidedAt.toISOString(),
          },
    hint: applicabilityHint({ visibleRefs: riskRefs, hiddenCount }),
    controls: r.mappings.map(({ control }) => ({
      code: control.code,
      title: control.title,
      status: statuses.get(control.id) ?? "notImplemented",
    })),
    riskRefs,
    groupKey: r.group?.key ?? null,
  };
}
