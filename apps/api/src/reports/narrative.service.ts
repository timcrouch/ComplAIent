import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  type BoardFactsInput,
  PostureSummaryOutput,
  buildPostureSummaryPrompt,
  guardText,
} from "@isms/ai";
import {
  type ApproveNarrativeInput,
  type BoardNarrativeDto,
  type NarrativeDraftResponse,
  conflictDetail,
} from "@isms/contracts";
import { type BoardPeriod, type Clock, DomainError } from "@isms/domain";
import { AiGatewayService } from "../ai/index.js";
import { type AuditContext, AuditService } from "../audit/index.js";
import { PolicyService } from "../authorization/index.js";
import { type Actor, CLOCK } from "../identity/index.js";
import { PRISMA, type PrismaService } from "../platform/index.js";
import { BoardService } from "./board.service.js";

/** The draft is tried once more when it uses a figure not in the facts, then refused. */
const DRAFT_ATTEMPTS = 2;
const DRAFT_MAX_TOKENS = 1500;
const DRAFT_TIMEOUT_MS = 60_000;
const UNVERIFIABLE = "The summary uses figures that are not in the records";

const aiUnavailable = (reason: string) =>
  new DomainError("CONFLICT", "The AI assistant is not available", [
    conflictDetail("aiUnavailable", reason, "aiUnavailable"),
  ]);
const invalid = (path: string, message: string) =>
  new DomainError("VALIDATION_FAILED", "Request validation failed", [{ path, message }]);

/**
 * The board narrative (§5.4): an AI draft on request, and approval of a narrative, AI-drafted or
 * typed. Every narrative may only use figures in the period's organisation-wide facts (the number
 * guard, P7-R5), and only organisation-wide readers draft or approve one (P7-R8).
 */
@Injectable()
export class NarrativeService {
  private readonly logger = new Logger(NarrativeService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly policy: PolicyService,
    private readonly ai: AiGatewayService,
    private readonly audit: AuditService,
    private readonly board: BoardService,
  ) {}

  /** P7-R8: reports.narrative and reports.read, both organisation-wide, so the facts are too. */
  private assertOrganisationWide(actor: Actor): void {
    if (
      !this.policy.can(actor, "reports.narrative") ||
      this.policy.accessScope(actor, "reports.read").kind !== "organisation"
    )
      throw new DomainError("FORBIDDEN", "Forbidden");
  }

  /** The current facts and top risks of the period: the model's only input. */
  private async input(actor: Actor, period: BoardPeriod): Promise<BoardFactsInput> {
    const { facts, topRisks } = await this.board.factsAndTopRisks(actor, period);
    return {
      period: { key: period.key, start: period.start, end: period.end },
      facts,
      topRisks: topRisks.map((r) => ({
        reference: r.reference,
        title: r.title,
        treatment: r.treatment,
      })),
    };
  }

  /**
   * Drafts the period's narrative; stores nothing (each attempt is an AiInteraction). A draft
   * using a figure not in the facts is retried once, then refused with 409 narrativeUnverifiable.
   */
  async draft(actor: Actor, periodKey: string): Promise<NarrativeDraftResponse> {
    this.assertOrganisationWide(actor);
    const period = this.board.period(periodKey);
    const readiness = await this.ai.readiness("posture_summary");
    if (!readiness.ready) throw aiUnavailable(readiness.reason);
    const input = await this.input(actor, period);
    const prompt = buildPostureSummaryPrompt(input);
    for (let attempt = 0; attempt < DRAFT_ATTEMPTS; attempt += 1) {
      const result = await this.ai.run("posture_summary", {
        ...prompt,
        schema: PostureSummaryOutput,
        schemaName: "posture_summary",
        maxTokens: DRAFT_MAX_TOKENS,
        timeoutMs: DRAFT_TIMEOUT_MS,
        actorUserId: actor.userId,
        object: { type: "BoardPeriod", id: period.key },
      });
      if (!result.ok) throw aiUnavailable(result.reason);
      const text = result.value.paragraphs.map((p) => p.trim()).join("\n\n");
      if (guardText(text, input).length === 0) {
        await this.ai.setOutcome(result.interactionId, "pending");
        return { text, interactionId: result.interactionId };
      }
      await this.ai.setOutcome(result.interactionId, "rejected");
    }
    throw new DomainError("CONFLICT", "The draft used figures that are not in the records", [
      conflictDetail("narrativeUnverifiable"),
    ]);
  }

  /**
   * Approves the period's narrative: appends a BoardNarrative (the newest wins) and audits
   * report.narrative_approved with the text's length only. The text is checked against the
   * current facts, whether drafted by the AI or typed (P7-R5).
   */
  async approve(
    actor: Actor,
    input: ApproveNarrativeInput,
    ctx: AuditContext,
  ): Promise<BoardNarrativeDto> {
    this.assertOrganisationWide(actor);
    const period = this.board.period(input.period);
    if (input.interactionId !== null) {
      // Provenance: an ok draft of this very period that the guard did not refuse.
      const interaction = await this.prisma.aiInteraction.findUnique({
        where: { id: input.interactionId },
        select: { purpose: true, status: true, outcome: true, objectType: true, objectId: true },
      });
      if (
        interaction?.purpose !== "posture_summary" ||
        interaction.status !== "ok" ||
        interaction.outcome === "rejected" ||
        interaction.objectType !== "BoardPeriod" ||
        interaction.objectId !== period.key
      )
        throw invalid("interactionId", "This is not a narrative draft of the period");
    }
    if (guardText(input.text, await this.input(actor, period)).length > 0)
      throw invalid("text", UNVERIFIABLE);

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.boardNarrative.create({
        data: {
          periodKey: period.key,
          periodStart: new Date(`${period.start}T00:00:00.000Z`),
          periodEnd: new Date(`${period.end}T00:00:00.000Z`),
          text: input.text,
          aiInteractionId: input.interactionId,
          approvedById: actor.userId,
          approvedAt: this.clock.now(),
        },
        select: {
          id: true,
          text: true,
          approvedAt: true,
          aiInteractionId: true,
          approvedBy: { select: { displayName: true } },
        },
      });
      await this.audit.record(
        {
          action: "report.narrative_approved",
          objectType: "BoardNarrative",
          objectId: created.id,
          after: {
            periodKey: period.key,
            aiAssisted: created.aiInteractionId !== null,
            text: { length: input.text.length },
          },
        },
        ctx,
        tx,
      );
      return created;
    });
    if (input.interactionId !== null) await this.recordAccepted(input.interactionId);
    return {
      text: row.text,
      approvedBy: row.approvedBy.displayName,
      approvedAt: row.approvedAt.toISOString(),
      aiAssisted: row.aiInteractionId !== null,
    };
  }

  /** Best effort: the narrative is already saved, and the outcome is only a measure. */
  private async recordAccepted(interactionId: string): Promise<void> {
    try {
      await this.ai.setOutcome(interactionId, "accepted");
    } catch (error) {
      this.logger.warn({
        event: "report.narrative_outcome_failed",
        error: error instanceof Error ? error.name : "unknown",
      });
    }
  }
}
