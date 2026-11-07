import { Inject, Injectable } from "@nestjs/common";
import {
  type ApproveRiskInput,
  type ConflictReason,
  type ReturnRiskInput,
  type RiskDetailDto,
  type SubmitRiskInput,
  conflictDetail,
} from "@isms/contracts";
import { Prisma } from "@isms/database";
import { DomainError, nextState, reviewDueDate, submitBlockers } from "@isms/domain";
import { type AuditContext, AuditService } from "../audit/index.js";
import { PolicyService, forbidden } from "../authorization/index.js";
import { type Actor, toRoleAssignmentDto } from "../identity/index.js";
import { RiskScaleService } from "../organisation/index.js";
import { PRISMA, type PrismaService } from "../platform/index.js";
import { approvalRefusalFor, mayReturn, ruleOf } from "./approval-readiness.js";
import { type RiskRow, riskScope } from "./mappers.js";
import { completeOpenReviewTasks, dateOnly, reviewIntervalMonths } from "./review-tasks.js";
import { RiskQueryService } from "./risk-query.service.js";
import { writeVersion } from "./risk-versions.js";

type Tx = Prisma.TransactionClient;

const conflict = (reason: ConflictReason, message: string, item?: string) =>
  new DomainError("CONFLICT", message, [conflictDetail(reason, item)]);
const stale = () => conflict("staleVersion", "The risk was changed by someone else");

const isUniqueViolation = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

/** Serialises every state change of one risk, so checks below cannot be raced. */
const lockRisk = (tx: Tx, id: string) =>
  tx.$executeRaw`SELECT 1 FROM "Risk" WHERE id = ${id}::uuid FOR UPDATE`;

/**
 * The actor with the role assignments as they are now, read under the risk lock. FOR SHARE
 * holds them until commit, so a revoke either committed before this read (and is honoured) or
 * waits for the decision; the roles read at authentication could be stale by then.
 */
async function currentActor(tx: Tx, actor: Actor): Promise<Actor> {
  await tx.$executeRaw`SELECT 1 FROM "RoleAssignment" WHERE "userId" = ${actor.userId}::uuid FOR SHARE`;
  const rows = await tx.roleAssignment.findMany({
    where: { userId: actor.userId },
    orderBy: { createdAt: "asc" },
    select: { role: true, scopeType: true, siteId: true, departmentId: true },
  });
  return { ...actor, roles: rows.map(toRoleAssignmentDto) };
}

/**
 * What an approval decision records: the decided version's own snapshot, its number, and the
 * evidence on the risk by id and SHA-256, so the files approved can be proven later.
 */
async function decisionSnapshot(tx: Tx, row: RiskRow): Promise<Prisma.InputJsonObject> {
  const version = await tx.riskVersion.findUniqueOrThrow({
    where: { riskId_version: { riskId: row.id, version: row.version } },
    select: { snapshot: true },
  });
  return {
    ...(version.snapshot as Prisma.JsonObject),
    version: row.version,
    evidence: row.evidence
      .map((e) => ({ id: e.id, sha256: e.sha256 }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/**
 * Submitting, approving and returning risks under server-side separation of duties (P3-R4).
 * The rules are `@isms/domain`'s; there is no override.
 */
@Injectable()
export class ApprovalService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly policy: PolicyService,
    private readonly query: RiskQueryService,
    private readonly scale: RiskScaleService,
  ) {}

  /** A reviewer submits a complete risk; they become its reviewer. */
  async submit(
    actor: Actor,
    id: string,
    input: SubmitRiskInput,
    ctx: AuditContext,
  ): Promise<RiskDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      await lockRisk(tx, id);
      const row = await this.query.getVisible(actor, id, tx);
      if (!this.policy.can(actor, "risks.review", riskScope(row))) throw forbidden();
      const next = nextState(row.state, "submit");
      if (next === null) throw conflict("invalidTransition", "The risk cannot be submitted now");
      if (row.version !== input.expectedVersion) throw stale();
      const blockers = submitBlockers(row);
      if (blockers.length > 0)
        throw new DomainError(
          "CONFLICT",
          "The risk is not ready for approval",
          blockers.map((b) => conflictDetail("submitBlocked", b)),
        );

      const updated = await tx.risk.update({
        where: { id },
        data: {
          state: next,
          reviewerId: actor.userId,
          submittedAt: new Date(),
          version: { increment: 1 },
        },
      });
      const changed = row.reviewerId === actor.userId ? ["state"] : ["state", "reviewerId"];
      await writeVersion(tx, updated, changed, actor.userId);
      await this.audit.record(
        {
          action: "risk.submitted",
          objectType: "Risk",
          objectId: id,
          before: { state: row.state, version: row.version, reviewerId: row.reviewerId },
          after: { state: updated.state, version: updated.version, reviewerId: actor.userId },
        },
        ctx,
        tx,
      );
    });
    return this.query.detail(actor, id);
  }

  /** Approves the submitted version, if `approvalRefusal` lets the actor. */
  approve(
    actor: Actor,
    id: string,
    input: ApproveRiskInput,
    ctx: AuditContext,
  ): Promise<RiskDetailDto> {
    return this.decide(actor, id, "approve", input, ctx);
  }

  /** Sends the submitted risk back with a comment: by its reviewer or anyone who could approve it. */
  return(
    actor: Actor,
    id: string,
    input: ReturnRiskInput,
    ctx: AuditContext,
  ): Promise<RiskDetailDto> {
    return this.decide(actor, id, "return", input, ctx);
  }

  /**
   * Order: visible (404), in review (409 invalidTransition), version (409 staleVersion), then
   * separation of duties (409 approvalRefused.<reason>) against the actor's roles as re-read
   * under the lock (`currentActor`).
   */
  private async decide(
    authenticated: Actor,
    id: string,
    action: "approve" | "return",
    input: { expectedVersion: number; comment?: string | undefined },
    ctx: AuditContext,
  ): Promise<RiskDetailDto> {
    let actor = authenticated;
    try {
      await this.prisma.$transaction(async (tx) => {
        await lockRisk(tx, id);
        actor = await currentActor(tx, authenticated);
        const row = await this.query.getVisible(actor, id, tx);
        const next = nextState(row.state, action);
        if (next === null) throw conflict("invalidTransition", "The risk is not in review");
        if (row.version !== input.expectedVersion) throw stale();
        const { appetiteThreshold } = await this.scale.currentAppetite(tx);
        const refusal = approvalRefusalFor(this.policy, actor, row, appetiteThreshold);
        const allowed =
          action === "approve"
            ? refusal === null
            : mayReturn(this.policy, actor, row, appetiteThreshold);
        if (!allowed && refusal !== null)
          throw conflict("approvalRefused", "Separation of duties refuses this", refusal);

        const comment = input.comment ?? "";
        const approval = await tx.approval.create({
          data: {
            riskId: id,
            version: row.version,
            decision: action === "approve" ? "approved" : "returned",
            comment,
            approverId: actor.userId,
            snapshot: await decisionSnapshot(tx, row),
          },
          select: { id: true },
        });
        const updated = await tx.risk.update({
          where: { id },
          data: {
            state: next,
            version: { increment: 1 },
            ...(action === "approve"
              ? {
                  approvedAt: new Date(),
                  nextReviewDue: dateOnly(
                    reviewDueDate(new Date(), await reviewIntervalMonths(tx)),
                  ),
                }
              : {}),
          },
        });
        await writeVersion(
          tx,
          updated,
          action === "approve" ? ["state", "nextReviewDue"] : ["state"],
          actor.userId,
        );
        if (action === "approve")
          await completeOpenReviewTasks(tx, this.audit, id, actor.userId, "", ctx);
        await this.audit.record(
          {
            action: action === "approve" ? "risk.approved" : "risk.returned",
            objectType: "Risk",
            objectId: id,
            before: { state: row.state, version: row.version },
            after: {
              state: updated.state,
              version: updated.version,
              decidedVersion: row.version,
              approvalId: approval.id,
              rule: ruleOf(row, appetiteThreshold),
              // Free text is audited by length only; the comment stays on the Approval.
              comment: { length: comment.length },
            },
          },
          ctx,
          tx,
        );
      });
    } catch (err) {
      // A second decision of the same version that passed every check above.
      if (isUniqueViolation(err)) throw stale();
      throw err;
    }
    return this.query.detail(actor, id);
  }
}
