import { Inject, Injectable } from "@nestjs/common";
import {
  type CloseRiskInput,
  type ConfirmReviewInput,
  type ConflictReason,
  type ReassessRiskInput,
  type RiskDetailDto,
  conflictDetail,
} from "@isms/contracts";
import type { Prisma } from "@isms/database";
import { DomainError, mayConfirmReview, nextState, reviewDueDate } from "@isms/domain";
import { type AuditContext, AuditService } from "../audit/index.js";
import { PolicyService, forbidden } from "../authorization/index.js";
import type { Actor } from "../identity/index.js";
import { PRISMA, type PrismaService } from "../platform/index.js";
import { type RiskRow, riskScope } from "./mappers.js";
import { RiskQueryService } from "./risk-query.service.js";
import { writeVersion } from "./risk-versions.js";
import { completeOpenReviewTasks, dateOnly, reviewIntervalMonths } from "./review-tasks.js";

type Tx = Prisma.TransactionClient;

const conflict = (reason: ConflictReason, message: string) =>
  new DomainError("CONFLICT", message, [conflictDetail(reason)]);

/**
 * Marking as treated, reassessing and confirming the periodic review of approved risks.
 * Order of checks: visible (404), risks.review (403), state (409 invalidTransition),
 * version (409 staleVersion), then the action's own rule.
 */
@Injectable()
export class RiskLifecycleService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly policy: PolicyService,
    private readonly query: RiskQueryService,
  ) {}

  /** Mark as treated: an approved risk with no open treatment action becomes closed. */
  close(
    actor: Actor,
    id: string,
    input: CloseRiskInput,
    ctx: AuditContext,
  ): Promise<RiskDetailDto> {
    return this.run(
      actor,
      id,
      input.expectedVersion,
      (row) => nextState(row.state, "close") !== null,
      async (tx, row) => {
        const open = await tx.task.count({
          where: { riskId: id, kind: "treatment_action", status: "open" },
        });
        if (open > 0) throw conflict("openTreatmentActions", "Treatment actions are still open");
        const now = new Date();
        const updated = await tx.risk.update({
          where: { id },
          data: {
            state: "closed",
            closedAt: now,
            closedById: actor.userId,
            nextReviewDue: dateOnly(reviewDueDate(now, await reviewIntervalMonths(tx))),
            version: { increment: 1 },
          },
        });
        const fields = ["state", "closedAt", "closedById", "nextReviewDue"];
        await writeVersion(tx, updated, fields, actor.userId, input.note);
        // Closing restarts the review clock, so an open review task is no longer needed.
        await completeOpenReviewTasks(tx, this.audit, id, actor.userId, input.note, ctx);
        await this.record(tx, ctx, "risk.closed", row, updated, {
          note: { length: input.note.length },
        });
      },
    );
  }

  /** Reassess: an approved or closed risk goes back to proposed for a new review cycle. */
  reassess(
    actor: Actor,
    id: string,
    input: ReassessRiskInput,
    ctx: AuditContext,
  ): Promise<RiskDetailDto> {
    return this.run(
      actor,
      id,
      input.expectedVersion,
      (row) => nextState(row.state, "reassess") !== null,
      async (tx, row) => {
        const updated = await tx.risk.update({
          where: { id },
          data: {
            state: "proposed",
            nextReviewDue: null,
            closedAt: null,
            closedById: null,
            reviewerId: null,
            submittedAt: null,
            version: { increment: 1 },
          },
        });
        const fields = [
          "state",
          "nextReviewDue",
          "closedAt",
          "closedById",
          "reviewerId",
          "submittedAt",
        ];
        await writeVersion(tx, updated, fields, actor.userId, input.reason);
        await this.record(tx, ctx, "risk.reassessed", row, updated, {
          reason: { length: input.reason.length },
        });
      },
    );
  }

  /** Confirm the risk is still accurate: the next review moves on, an open review task is done. */
  confirmReview(
    actor: Actor,
    id: string,
    input: ConfirmReviewInput,
    ctx: AuditContext,
  ): Promise<RiskDetailDto> {
    return this.run(
      actor,
      id,
      input.expectedVersion,
      (row) => mayConfirmReview(row.state),
      async (tx, row) => {
        const updated = await tx.risk.update({
          where: { id },
          data: {
            nextReviewDue: dateOnly(reviewDueDate(new Date(), await reviewIntervalMonths(tx))),
            version: { increment: 1 },
          },
        });
        await completeOpenReviewTasks(tx, this.audit, id, actor.userId, input.note, ctx);
        await writeVersion(tx, updated, ["nextReviewDue"], actor.userId, input.note);
        await this.record(tx, ctx, "risk.review_confirmed", row, updated, {
          note: { length: input.note.length },
        });
      },
    );
  }

  private async run(
    actor: Actor,
    id: string,
    expectedVersion: number,
    stateAllows: (row: RiskRow) => boolean,
    apply: (tx: Tx, row: RiskRow) => Promise<void>,
  ): Promise<RiskDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM "Risk" WHERE id = ${id}::uuid FOR UPDATE`;
      const row = await this.query.getVisible(actor, id, tx);
      if (!this.policy.can(actor, "risks.review", riskScope(row))) throw forbidden();
      if (!stateAllows(row))
        throw conflict("invalidTransition", "The risk is not in a state that allows this");
      if (row.version !== expectedVersion)
        throw conflict("staleVersion", "The risk was changed by someone else");
      await apply(tx, row);
    });
    return this.query.detail(actor, id);
  }

  private record(
    tx: Tx,
    ctx: AuditContext,
    action: string,
    before: RiskRow,
    after: { state: string; version: number },
    extra: Prisma.InputJsonObject,
  ) {
    return this.audit.record(
      {
        action,
        objectType: "Risk",
        objectId: before.id,
        before: { state: before.state, version: before.version },
        after: { state: after.state, version: after.version, ...extra },
      },
      ctx,
      tx,
    );
  }
}
