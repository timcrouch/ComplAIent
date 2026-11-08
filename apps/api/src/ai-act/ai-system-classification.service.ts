import { Inject, Injectable, Logger } from "@nestjs/common";
import type {
  AiClassificationRecord,
  AiSystemDetailDto,
  ClassifyAiSystemInput,
  UpdateAiObligationInput,
} from "@isms/contracts";
import {
  type AiObligationKey,
  type Clock,
  applicableObligations,
  classifyAiSystem,
} from "@isms/domain";
import { AiGatewayService } from "../ai/index.js";
import { type AuditContext, type AuditJson, AuditService } from "../audit/index.js";
import { CLOCK, type Actor } from "../identity/index.js";
import { PRISMA, type PrismaService } from "../platform/index.js";
import { AiSystemReader, lockSystem, notFound } from "./ai-system-reader.js";
import { invalid } from "./errors.js";
import { reconcileObligations } from "./reconcile.js";

/**
 * Saving a classification and working on obligations (#16 §4, §5). The class always comes
 * from `classifyAiSystem` on the server; the client only sends answers.
 */
@Injectable()
export class AiSystemClassificationService {
  private readonly logger = new Logger(AiSystemClassificationService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly reader: AiSystemReader,
    private readonly ai: AiGatewayService,
  ) {}

  /**
   * Classifies from the answers and reconciles the obligations in one transaction: new keys
   * open, stored rows keep status and note and get `applicable` set, nothing is deleted.
   * `interactionId` must be an ok, unrejected `ai_act_classification` draft of this system
   * (400 otherwise); it makes the source `ai_assisted`. Saving again with the same answers
   * re-records the classification (a deliberate re-confirmation) and is audited.
   */
  async classify(
    actor: Actor,
    id: string,
    input: ClassifyAiSystemInput,
    ctx: AuditContext,
  ): Promise<AiSystemDetailDto> {
    if (input.interactionId !== null) await this.checkDraft(id, input.interactionId);
    const result = classifyAiSystem(input.answers);
    const record: AiClassificationRecord = {
      version: 1,
      answers: input.answers,
      source: input.interactionId === null ? "manual" : "ai_assisted",
      result,
    };
    await this.prisma.$transaction(async (tx) => {
      await lockSystem(tx, id);
      const stored = await tx.aiSystem.findUniqueOrThrow({
        where: { id },
        select: { role: true, riskClass: true },
      });
      await tx.aiSystem.update({
        where: { id },
        data: {
          riskClass: result.riskClass,
          classification: record,
          classifiedAt: this.clock.now(),
          classifiedById: actor.userId,
        },
        select: { id: true },
      });
      const plan = await reconcileObligations(
        tx,
        id,
        applicableObligations(result, stored.role, input.answers),
      );
      await this.audit.record(
        {
          action: "ai_system.classified",
          objectType: "AiSystem",
          objectId: id,
          before: { riskClass: stored.riskClass },
          after: {
            riskClass: result.riskClass,
            source: record.source,
            derogationApplied: result.derogationApplied,
            transparencyDuties: result.transparencyDuties,
            answers: input.answers as unknown as AuditJson,
            obligations: plan,
          },
        },
        ctx,
        tx,
      );
    });
    if (input.interactionId !== null) await this.recordAccepted(input.interactionId);
    return this.reader.detail(actor, id);
  }

  /**
   * Sets an obligation's status or note. 404 when the system has no row for the key (it is
   * not classified yet). The audit trail records whether the note changed, never its text.
   */
  async updateObligation(
    actor: Actor,
    id: string,
    key: AiObligationKey,
    input: UpdateAiObligationInput,
    ctx: AuditContext,
  ): Promise<AiSystemDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      await lockSystem(tx, id);
      const where = { aiSystemId_key: { aiSystemId: id, key } };
      const stored = await tx.aiSystemObligation.findUnique({
        where,
        select: { status: true, note: true },
      });
      if (!stored) throw notFound();
      const status = input.status ?? stored.status;
      const note = input.note ?? stored.note;
      const noteChanged = note !== stored.note;
      if (status === stored.status && !noteChanged) return;
      await tx.aiSystemObligation.update({
        where,
        data: { status, note, updatedById: actor.userId },
        select: { key: true },
      });
      await this.audit.record(
        {
          action: "ai_system.obligation_updated",
          objectType: "AiSystem",
          objectId: id,
          // `obligation`, not `key`: the audit trail drops credential-named fields such as `key`.
          before: { obligation: key, status: stored.status },
          after: { obligation: key, status, ...(noteChanged ? { noteChanged: true } : {}) },
        },
        ctx,
        tx,
      );
    });
    return this.reader.detail(actor, id);
  }

  /** Provenance of an AI-assisted save: an ok draft of this very system, not rejected. */
  private async checkDraft(id: string, interactionId: string): Promise<void> {
    const interaction = await this.prisma.aiInteraction.findUnique({
      where: { id: interactionId },
      select: { purpose: true, status: true, outcome: true, objectType: true, objectId: true },
    });
    if (
      interaction?.purpose !== "ai_act_classification" ||
      interaction.status !== "ok" ||
      interaction.outcome === "rejected" ||
      interaction.objectType !== "AiSystem" ||
      interaction.objectId !== id
    )
      throw invalid("interactionId", "This is not a classification draft of this system");
  }

  /** Best effort: the classification is already saved, and the outcome is only a measure. */
  private async recordAccepted(interactionId: string): Promise<void> {
    try {
      await this.ai.setOutcome(interactionId, "accepted");
    } catch (error) {
      this.logger.warn({
        event: "ai_system.classification_outcome_failed",
        error: error instanceof Error ? error.name : "unknown",
      });
    }
  }
}
