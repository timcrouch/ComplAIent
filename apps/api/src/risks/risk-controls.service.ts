import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  type AddControlInput,
  type DecideControlInput,
  type RemoveControlInput,
  type RequestControlSuggestionsInput,
  type RiskDetailDto,
  conflictDetail,
} from "@isms/contracts";
import type { Prisma } from "@isms/database";
import { DomainError, isEditable } from "@isms/domain";
import type { AiOutcome } from "@isms/ai";
import type { JobsClient } from "@isms/jobs";
import { AiGatewayService } from "../ai/index.js";
import { type AuditContext, type AuditJson, AuditService } from "../audit/index.js";
import { PolicyService, forbidden } from "../authorization/index.js";
import type { Actor } from "../identity/index.js";
import { JOBS, PRISMA, type PrismaService } from "../platform/index.js";
import { type RiskRow, riskScope } from "./mappers.js";
import { RiskQueryService } from "./risk-query.service.js";
import { writeVersion } from "./risk-versions.js";

type Tx = Prisma.TransactionClient;

const conflict = (reason: Parameters<typeof conflictDetail>[0], message: string, item?: string) =>
  new DomainError("CONFLICT", message, [conflictDetail(reason, item)]);
const notFound = () => new DomainError("NOT_FOUND", "Not found");

/** What one change did: its audit row, and the AI outcome to record once it has committed. */
type Applied = {
  action: string;
  after: Record<string, AuditJson>;
  outcome?: { interactionId: string; outcome: AiOutcome };
};

/** Control suggestions and decisions on a proposed or returned risk (P3-R3, P3-R11). */
@Injectable()
export class RiskControlsService {
  private readonly logger = new Logger(RiskControlsService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    @Inject(JOBS) private readonly jobs: JobsClient,
    private readonly audit: AuditService,
    private readonly policy: PolicyService,
    private readonly query: RiskQueryService,
    private readonly ai: AiGatewayService,
  ) {}

  /** Marks the risk pending and queues one suggestion job per risk version. */
  async requestSuggestions(
    actor: Actor,
    id: string,
    input: RequestControlSuggestionsInput,
    ctx: AuditContext,
  ): Promise<RiskDetailDto> {
    // Scope first (404 / 403), then readiness, so neither is hidden by or held under the row lock.
    const seen = await this.query.getVisible(actor, id);
    if (!this.policy.can(actor, "risks.review", riskScope(seen))) throw forbidden();
    const readiness = await this.ai.readiness("control_suggestion");
    if (!readiness.ready)
      throw conflict(
        "aiUnavailable",
        "The AI cannot suggest controls now; add them by hand",
        readiness.reason,
      );
    const version = await this.prisma.$transaction(async (tx) => {
      const row = await this.lockAndCheck(tx, actor, id, input.expectedVersion);
      await tx.risk.update({
        where: { id },
        data: { controlSuggestion: "pending", controlSuggestionFailure: null },
        select: { id: true },
      });
      await this.audit.record(
        {
          action: "risk.control_suggestions_requested",
          objectType: "Risk",
          objectId: id,
          before: { version: row.version },
          after: { version: row.version },
        },
        ctx,
        tx,
      );
      return row.version;
    });
    const idempotencyKey = `${id}__${String(version)}`;
    try {
      // A failed or completed run at this version may be asked for again; a live one is kept.
      await this.jobs.removeFinished("risk.suggest_controls", idempotencyKey);
      await this.jobs.enqueue(
        "risk.suggest_controls",
        { riskId: id, requestedById: actor.userId, version },
        { idempotencyKey },
      );
    } catch (error) {
      this.logger.warn({
        event: "risk_controls.enqueue_failed",
        error: error instanceof Error ? error.name : "unknown",
      });
      await this.prisma.risk.updateMany({
        where: { id },
        data: { controlSuggestion: "failed", controlSuggestionFailure: "unavailable" },
      });
      // The queue is down: the same plain answer as AI being unavailable (add them by hand).
      throw conflict(
        "aiUnavailable",
        "The AI cannot suggest controls now; add them by hand",
        "unavailable",
      );
    }
    return this.query.detail(actor, id);
  }

  async decide(
    actor: Actor,
    id: string,
    riskControlId: string,
    input: DecideControlInput,
    ctx: AuditContext,
  ): Promise<RiskDetailDto> {
    const outcome = await this.change(actor, id, input.expectedVersion, ctx, async (tx) => {
      const rc = await tx.riskControl.findFirst({
        where: { id: riskControlId, riskId: id },
        select: {
          status: true,
          aiInteractionId: true,
          control: { select: { code: true } },
        },
      });
      if (!rc) throw notFound();
      if (rc.status !== "suggested")
        throw conflict("controlNotAccepted", "Only a suggested control can be decided");
      const accepted = input.decision === "accept";
      await tx.riskControl.update({
        where: { id: riskControlId },
        data: {
          status: accepted ? "accepted" : "rejected",
          decidedById: actor.userId,
          decidedAt: new Date(),
          ...(input.reason === undefined ? {} : { reason: input.reason }),
        },
        select: { id: true },
      });
      return {
        action: accepted ? "risk.control_accepted" : "risk.control_rejected",
        after: this.auditAfter(rc.control.code, input.reason),
        ...(rc.aiInteractionId === null
          ? {}
          : { outcome: await this.runOutcome(tx, rc.aiInteractionId) }),
      };
    });
    if (outcome) await this.recordOutcome(outcome);
    return this.query.detail(actor, id);
  }

  async add(
    actor: Actor,
    id: string,
    input: AddControlInput,
    ctx: AuditContext,
  ): Promise<RiskDetailDto> {
    await this.change(actor, id, input.expectedVersion, ctx, async (tx) => {
      const control = await tx.control.findFirst({
        where: { code: input.controlCode },
        select: { id: true, code: true },
      });
      if (!control)
        throw new DomainError("VALIDATION_FAILED", "Request validation failed", [
          { path: "controlCode", message: "Unknown control code" },
        ]);
      const linked = await tx.riskControl.findFirst({
        where: { riskId: id, controlId: control.id },
        select: { id: true, status: true },
      });
      if (linked && linked.status !== "rejected")
        throw conflict("duplicateRiskControl", "This control is already linked");
      const decided = {
        status: "accepted" as const,
        source: "person" as const,
        reason: input.reason ?? "",
        decidedById: actor.userId,
        decidedAt: new Date(),
      };
      if (linked) {
        // A person overrides the rejection; the row leaves the AI run so its outcome stands.
        await tx.riskControl.update({
          where: { id: linked.id },
          data: { ...decided, aiInteractionId: null },
          select: { id: true },
        });
      } else {
        await tx.riskControl.create({
          data: { riskId: id, controlId: control.id, ...decided },
          select: { id: true },
        });
      }
      return {
        action: "risk.control_added",
        after: this.auditAfter(control.code, input.reason),
      };
    });
    return this.query.detail(actor, id);
  }

  async remove(
    actor: Actor,
    id: string,
    riskControlId: string,
    input: RemoveControlInput,
    ctx: AuditContext,
  ): Promise<RiskDetailDto> {
    await this.change(actor, id, input.expectedVersion, ctx, async (tx) => {
      const rc = await tx.riskControl.findFirst({
        where: { id: riskControlId, riskId: id },
        select: {
          status: true,
          controlId: true,
          control: { select: { code: true } },
        },
      });
      if (!rc) throw notFound();
      const evidence = await tx.evidenceControl.count({
        where: { controlId: rc.controlId, evidence: { riskId: id } },
      });
      if (rc.status !== "accepted" || evidence > 0)
        throw conflict(
          "controlNotAccepted",
          "Only an accepted control without evidence can be removed",
        );
      // An open request would be left impossible to complete (the upload needs the control).
      const openRequests = await tx.task.count({
        where: { riskId: id, controlId: rc.controlId, kind: "evidence_request", status: "open" },
      });
      if (openRequests > 0)
        throw conflict(
          "controlHasOpenRequest",
          "A control with an open evidence request cannot be removed",
        );
      await tx.riskControl.delete({
        where: { id: riskControlId },
        select: { id: true },
      });
      return {
        action: "risk.control_removed",
        after: { controlCode: rc.control.code },
      };
    });
    return this.query.detail(actor, id);
  }

  /** Locks the risk and checks scope, permission, editable state and version (409 otherwise). */
  private async lockAndCheck(
    tx: Tx,
    actor: Actor,
    id: string,
    expectedVersion: number,
  ): Promise<RiskRow> {
    await tx.$executeRaw`SELECT 1 FROM "Risk" WHERE id = ${id}::uuid FOR UPDATE`;
    const row = await this.query.getVisible(actor, id, tx);
    if (!this.policy.can(actor, "risks.review", riskScope(row))) throw forbidden();
    if (!isEditable(row.state)) throw conflict("riskNotEditable", "The risk cannot be edited");
    if (row.version !== expectedVersion)
      throw conflict("staleVersion", "The risk was changed by someone else");
    return row;
  }

  /**
   * One versioned change of a risk's controls: `apply` makes it, then the version is raised,
   * the snapshot written and the audit row recorded, all in this transaction.
   */
  private async change(
    actor: Actor,
    id: string,
    expectedVersion: number,
    ctx: AuditContext,
    apply: (tx: Tx) => Promise<Applied>,
  ): Promise<Applied["outcome"]> {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.lockAndCheck(tx, actor, id, expectedVersion);
      const applied = await apply(tx);
      const updated = await tx.risk.update({
        where: { id },
        data: { version: { increment: 1 } },
      });
      await writeVersion(tx, updated, ["controls"], actor.userId);
      await this.audit.record(
        {
          action: applied.action,
          objectType: "Risk",
          objectId: id,
          before: { version: row.version },
          after: { version: updated.version, ...applied.after },
        },
        ctx,
        tx,
      );
      return applied.outcome;
    });
  }

  /** Free text goes into the audit trail by length only; the reason stays in the row. */
  private auditAfter(controlCode: string, reason: string | undefined): Record<string, AuditJson> {
    return reason === undefined
      ? { controlCode }
      : { controlCode, reason: { changed: true, length: reason.length } };
  }

  /** The outcome of an AI run once all its suggestions are decided; "pending" while any is open. */
  private async runOutcome(
    tx: Tx,
    interactionId: string,
  ): Promise<{ interactionId: string; outcome: AiOutcome }> {
    const rows = await tx.riskControl.findMany({
      where: { aiInteractionId: interactionId },
      select: { status: true },
    });
    const accepted = rows.filter((r) => r.status === "accepted").length;
    const rejected = rows.filter((r) => r.status === "rejected").length;
    let outcome: AiOutcome = "pending";
    if (accepted + rejected === rows.length)
      outcome = rejected === 0 ? "accepted" : accepted === 0 ? "rejected" : "partial";
    return { interactionId, outcome };
  }

  /** Best effort: the decision is already saved, and the outcome is only a measure. */
  private async recordOutcome(o: { interactionId: string; outcome: AiOutcome }): Promise<void> {
    try {
      await this.ai.setOutcome(o.interactionId, o.outcome);
    } catch (error) {
      this.logger.warn({
        event: "risk_controls.outcome_failed",
        error: error instanceof Error ? error.name : "unknown",
      });
    }
  }
}
