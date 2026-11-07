import { Inject, Injectable } from "@nestjs/common";
import {
  type RiskChanges,
  type RiskDetailDto,
  type RiskEditInput,
  conflictDetail,
} from "@isms/contracts";
import type { Prisma } from "@isms/database";
import { DomainError, type ResidualProblem, isEditable, residualProblems } from "@isms/domain";
import { type AuditContext, type AuditJson, AuditService } from "../audit/index.js";
import { PolicyService, type ResourceScope, forbidden } from "../authorization/index.js";
import type { Actor } from "../identity/index.js";
import { RiskScaleService } from "../organisation/index.js";
import { PRISMA, type PrismaService } from "../platform/index.js";
import { resolveAssets } from "./assets.js";
import { fieldAudit } from "./risk-edit-audit.js";
import { type RiskRow, riskScope } from "./mappers.js";
import { RiskQueryService } from "./risk-query.service.js";
import { writeVersion } from "./risk-versions.js";
import { assertUnitsExist } from "./units.js";

type Tx = Prisma.TransactionClient;

/** Fields copied as they are; the order is the order of `changedFields`. */
const PLAIN_FIELDS = [
  "title",
  "scenario",
  "threat",
  "consequence",
  "existingSafeguards",
  "toConfirm",
  "likelihood",
  "impact",
  "residualLikelihood",
  "residualImpact",
  "treatment",
  "treatmentNote",
  "ownerId",
  "siteId",
  "departmentId",
] as const satisfies readonly (keyof RiskChanges & keyof RiskRow)[];

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const conflict = (reason: "riskNotEditable" | "staleVersion", message: string) =>
  new DomainError("CONFLICT", message, [conflictDetail(reason)]);

const OWNER_RULE = "The owner must be a risk owner or CISO for this risk";
const OWNER_MOVED = "Owner not eligible in the new scope";

const RESIDUAL_MESSAGES: Record<ResidualProblem, string> = {
  residualAboveInherent: "Expected likelihood and impact cannot exceed the current ones",
  residualForAccept: "An accepted risk has no expected score",
};

/** What one edit changes: the update data and the audited before and after values. */
type Plan = {
  changed: string[];
  data: Prisma.RiskUncheckedUpdateInput;
  before: Record<string, AuditJson>;
  after: Record<string, AuditJson>;
  assetIds: string[] | null;
};

/** Versioned edits of a proposed or returned risk by a reviewer (P3-R3). */
@Injectable()
export class RiskEditService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly policy: PolicyService,
    private readonly query: RiskQueryService,
    private readonly scale: RiskScaleService,
  ) {}

  async update(
    actor: Actor,
    id: string,
    input: RiskEditInput,
    ctx: AuditContext,
  ): Promise<RiskDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      // Serialises concurrent edits, so the version check below cannot be raced.
      await tx.$executeRaw`SELECT 1 FROM "Risk" WHERE id = ${id}::uuid FOR UPDATE`;
      const row = await this.query.getVisible(actor, id, tx);
      if (!this.policy.can(actor, "risks.review", riskScope(row))) throw forbidden();
      if (!isEditable(row.state)) throw conflict("riskNotEditable", "The risk cannot be edited");
      if (row.version !== input.expectedVersion)
        throw conflict("staleVersion", "The risk was changed by someone else");

      const plan = await this.plan(tx, actor, row, input.changes);
      if (plan.changed.length === 0) return;
      const updated = await tx.risk.update({
        where: { id },
        data: { ...plan.data, version: { increment: 1 } },
      });
      if (plan.assetIds) {
        await tx.riskAsset.deleteMany({ where: { riskId: id } });
        await tx.riskAsset.createMany({
          data: plan.assetIds.map((assetId) => ({ riskId: id, assetId })),
        });
      }
      await writeVersion(tx, updated, plan.changed, actor.userId);
      await this.audit.record(
        {
          action: "risk.updated",
          objectType: "Risk",
          objectId: id,
          before: { version: row.version, ...plan.before },
          after: { version: updated.version, ...plan.after },
        },
        ctx,
        tx,
      );
    });
    return this.query.detail(actor, id);
  }

  /** Validates the changes against the stored risk and keeps only real differences. */
  private async plan(tx: Tx, actor: Actor, row: RiskRow, changes: RiskChanges): Promise<Plan> {
    const plan: Plan = { changed: [], data: {}, before: {}, after: {}, assetIds: null };
    await assertUnitsExist(tx, changes, "changes.");
    const target = {
      siteId: changes.siteId === undefined ? row.siteId : changes.siteId,
      departmentId: changes.departmentId === undefined ? row.departmentId : changes.departmentId,
    };
    const scope = riskScope(target);
    // A reviewer cannot move a risk to where they could no longer review it.
    if (!this.policy.can(actor, "risks.review", scope)) throw forbidden();

    const data: Record<string, unknown> = {};
    for (const field of PLAIN_FIELDS) {
      const next = changes[field];
      if (next === undefined || same(row[field], next)) continue;
      plan.changed.push(field);
      data[field] = next;
      const entry = fieldAudit(field, row[field], next);
      if ("before" in entry) plan.before[field] = entry.before;
      plan.after[field] = entry.after;
    }
    // Accepting a risk leaves no expected score: clear it in the same edit.
    if (changes.treatment === "accept") {
      for (const field of ["residualLikelihood", "residualImpact"] as const) {
        if (row[field] === null || changes[field] != null || plan.changed.includes(field)) continue;
        plan.changed.push(field);
        data[field] = null;
        plan.before[field] = row[field];
        plan.after[field] = null;
      }
    }
    plan.data = data;
    this.assertResidual(row, data, plan.changed);

    if (plan.changed.includes("ownerId")) {
      if (changes.ownerId) await this.assertEligibleOwner(tx, changes.ownerId, scope, OWNER_RULE);
    } else if (
      row.ownerId !== null &&
      (plan.changed.includes("siteId") || plan.changed.includes("departmentId"))
    ) {
      // The owner stays: they must still be eligible where the risk now belongs.
      await this.assertEligibleOwner(tx, row.ownerId, scope, OWNER_MOVED);
    }
    if (plan.changed.includes("likelihood") || plan.changed.includes("impact"))
      plan.data.riskScaleId = (await this.scale.currentAppetite(tx)).riskScaleId;

    if (changes.assets !== undefined) {
      const ids = await resolveAssets(tx, changes.assets, target.siteId);
      const current = row.assets.map((a) => a.asset.id);
      if (!same([...ids].sort(), [...current].sort())) {
        plan.changed.push("assets");
        plan.before["assets"] = { count: current.length };
        plan.after["assets"] = { count: ids.length };
        plan.assetIds = ids;
      }
    }
    return plan;
  }

  /**
   * The would-be stored combination must pass the residual rules (400, P5-R1). A problem is
   * reported on the inherent field when the edit changed it, otherwise on the residual field.
   */
  private assertResidual(row: RiskRow, data: Record<string, unknown>, changed: string[]) {
    const next = { ...row, ...data };
    const problems = residualProblems(next);
    if (problems.length === 0) return;
    const details = new Map<string, { path: string; message: string }>();
    const add = (field: string, problem: ResidualProblem) =>
      details.set(`${field}:${problem}`, {
        path: `changes.${field}`,
        message: RESIDUAL_MESSAGES[problem],
      });
    for (const problem of problems) {
      for (const axis of ["Likelihood", "Impact"] as const) {
        const inherent = axis === "Likelihood" ? "likelihood" : "impact";
        const residual = `residual${axis}` as const;
        const value = next[residual];
        if (value === null) continue;
        if (problem === "residualAboveInherent") {
          const base = next[inherent];
          if (base !== null && value <= base) continue;
          add(changed.includes(inherent) ? inherent : residual, problem);
        } else add(residual, problem);
      }
    }
    throw new DomainError("VALIDATION_FAILED", "Request validation failed", [...details.values()]);
  }

  /** The owner must hold risk_owner or ciso at a scope matching the risk (400 otherwise). */
  private async assertEligibleOwner(
    tx: Tx,
    ownerId: string,
    scope: ResourceScope,
    message: string,
  ) {
    const match: Prisma.RoleAssignmentWhereInput[] = [{ scopeType: "ORGANISATION" }];
    if (scope.siteId) match.push({ scopeType: "SITE", siteId: scope.siteId });
    if (scope.departmentId)
      match.push({ scopeType: "DEPARTMENT", departmentId: scope.departmentId });
    const grant = await tx.roleAssignment.findFirst({
      where: { userId: ownerId, role: { in: ["risk_owner", "ciso"] }, OR: match },
      select: { id: true },
    });
    if (!grant)
      throw new DomainError("VALIDATION_FAILED", "Request validation failed", [
        { path: "changes.ownerId", message },
      ]);
  }
}
