import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  CONCERN_ASSET_TYPES,
  MAX_CONCERN_QUESTIONS,
  buildConcernTurnPrompt,
  concernTranscript,
  concernTurnSchema,
} from "@isms/ai";
import {
  type ConcernAiStatusDto,
  type ConcernReplyInput,
  type ConversationDto,
  type ReportRiskInput,
  type RiskDetailDto,
  conflictDetail,
} from "@isms/contracts";
import { Prisma } from "@isms/database";
import { DomainError } from "@isms/domain";
import { AiGatewayService } from "../ai/index.js";
import { type AuditContext, AuditService } from "../audit/index.js";
import type { Actor } from "../identity/index.js";
import { PRISMA, type PrismaService } from "../platform/index.js";
import { RiskReportService } from "../risks/index.js";
import { addToConfirm, draftFromSummary, readStoredDraft } from "./concern-draft.js";
import { toConversationDto } from "./conversation.view.js";

type Db = Prisma.TransactionClient;

const notFound = () => new DomainError("NOT_FOUND", "Not found");
const closed = () =>
  new DomainError("CONFLICT", "The conversation is no longer open", [
    conflictDetail("conversationClosed"),
  ]);
const aiUnavailable = (reason: string) =>
  new DomainError("CONFLICT", "The AI cannot answer now; use the form", [
    conflictDetail("aiUnavailable", reason, "aiUnavailable"),
  ]);
/** Another reply's turn wrote first; this turn's answer is dropped (the reply itself is kept). */
const overtaken = () =>
  new DomainError("CONFLICT", "The conversation changed during this turn", [
    conflictDetail("staleVersion"),
  ]);

const TURN_TIMEOUT_MS = 20_000; // P3-R7
const TURN_MAX_TOKENS = 2000;

/**
 * Reporting a concern by conversation. The reporter's words are stored before each AI turn, so a
 * failed turn loses nothing and the web can fall back to the form. AI output becomes a question
 * or a server-side draft only; the risk exists once the reporter submits (spec §8, P3-R5).
 */
@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly ai: AiGatewayService,
    private readonly audit: AuditService,
    private readonly reports: RiskReportService,
  ) {}

  async aiStatus(): Promise<ConcernAiStatusDto> {
    const readiness = await this.ai.readiness("concern_turn");
    return readiness.ready
      ? { available: true, reason: null }
      : { available: false, reason: readiness.reason };
  }

  /** Stores the first message and runs the first turn. With AI unavailable nothing is stored. */
  async start(actor: Actor, text: string, ctx: AuditContext): Promise<ConversationDto> {
    const status = await this.aiStatus();
    if (!status.available) throw aiUnavailable(status.reason ?? "disabled");
    const id = await this.prisma.$transaction(async (tx) => {
      const c = await tx.concernConversation.create({
        data: { reporterId: actor.userId, toConfirm: [] },
      });
      await tx.concernMessage.create({
        data: { conversationId: c.id, seq: 1, role: "reporter", text, chips: [] },
      });
      // No free text in the audit history: the reporter's words stay in the conversation.
      await this.audit.record(
        { action: "concern.started", objectType: "ConcernConversation", objectId: c.id },
        ctx,
        tx,
      );
      return c.id;
    });
    try {
      await this.turn(actor, id);
    } catch (error) {
      // The conversation is kept: name it so the web can resume or abandon it.
      if (error instanceof DomainError && error.code === "CONFLICT") {
        throw new DomainError(error.code, error.message, [
          ...(error.details ?? []),
          { path: "conversationId", message: id },
        ]);
      }
      throw error;
    }
    return this.get(actor, id);
  }

  /** Stores the answer (a "not sure" adds the question to toConfirm, P3-R6), then runs a turn. */
  async reply(
    actor: Actor,
    id: string,
    input: ConcernReplyInput,
    ctx: AuditContext,
  ): Promise<ConversationDto> {
    await this.prisma.$transaction(async (tx) => {
      const c = await this.lockOpen(tx, actor, id);
      const last = await tx.concernMessage.findFirst({
        where: { conversationId: id },
        orderBy: { seq: "desc" },
      });
      const seq = (last?.seq ?? 0) + 1;
      // An assistant message with text is a question; a summary is stored with empty text.
      const question = last?.role === "assistant" && last.text.length > 0 ? last.text : null;
      if (input.notSure && question !== null) {
        await tx.concernConversation.update({
          where: { id },
          data: { toConfirm: addToConfirm(c.toConfirm, question) },
        });
      }
      await tx.concernMessage.create({
        data: {
          conversationId: id,
          seq,
          role: "reporter",
          text: input.text,
          chips: [],
          notSure: input.notSure,
        },
      });
      await this.audit.record(
        {
          action: "concern.replied",
          objectType: "ConcernConversation",
          objectId: id,
          after: { seq, notSure: input.notSure },
        },
        ctx,
        tx,
      );
    });
    await this.turn(actor, id);
    return this.get(actor, id);
  }

  async get(actor: Actor, id: string): Promise<ConversationDto> {
    const c = await this.prisma.concernConversation.findFirst({
      where: { id, reporterId: actor.userId },
      include: { messages: { orderBy: { seq: "asc" } } },
    });
    if (!c) throw notFound();
    return toConversationDto(c, await this.aiStatus());
  }

  /** Reports the checked draft; the AI estimate comes from the stored draft only (P3-R5). */
  async submit(
    actor: Actor,
    id: string,
    input: ReportRiskInput,
    ctx: AuditContext,
  ): Promise<RiskDetailDto> {
    const c = await this.prisma.concernConversation.findFirst({
      where: { id, reporterId: actor.userId },
      select: { status: true, draft: true },
    });
    if (!c) throw notFound();
    if (c.status !== "open") throw closed();
    const stored = readStoredDraft(c.draft);
    // report() marks the conversation submitted and links the risk in its own transaction.
    const risk = await this.reports.report(actor, input, ctx, {
      aiAssisted: true,
      conversationId: id,
      aiEstimate: stored?.draft.aiEstimate ?? null,
    });
    // Best effort: the risk is committed; a lost outcome must not turn the report into a 500.
    if (stored) {
      try {
        await this.ai.setOutcome(stored.interactionId, "accepted");
      } catch {
        this.logger.warn({
          event: "concern.outcome_not_recorded",
          interactionId: stored.interactionId,
        });
      }
    }
    return risk;
  }

  async abandon(actor: Actor, id: string, ctx: AuditContext): Promise<ConversationDto> {
    await this.prisma.$transaction(async (tx) => {
      await this.lockOpen(tx, actor, id);
      await tx.concernConversation.update({ where: { id }, data: { status: "abandoned" } });
      await this.audit.record(
        {
          action: "concern.abandoned",
          objectType: "ConcernConversation",
          objectId: id,
          before: { status: "open" },
          after: { status: "abandoned" },
        },
        ctx,
        tx,
      );
    });
    return this.get(actor, id);
  }

  /** The reporter's open conversation, locked for this transaction; 404 or 409 otherwise. */
  private async lockOpen(tx: Db, actor: Actor, id: string) {
    await tx.$queryRaw`SELECT 1 FROM "ConcernConversation" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const c = await tx.concernConversation.findFirst({ where: { id, reporterId: actor.userId } });
    if (!c) throw notFound();
    if (c.status !== "open") throw closed();
    return c;
  }

  /**
   * One AI turn over the whole conversation. A question is stored as an assistant message; a
   * summary stores the draft (and an empty assistant message, so roles keep alternating). A
   * failed turn stores nothing and is 409 aiUnavailable.<reason>. Turns are serialised: the
   * result is written only if nothing was added since the turn read the conversation (otherwise
   * 409 staleVersion), so concurrent replies cannot pass the question limit.
   */
  private async turn(actor: Actor, id: string): Promise<void> {
    const c = await this.prisma.concernConversation.findUniqueOrThrow({
      where: { id },
      include: { messages: { orderBy: { seq: "asc" } } },
    });
    const sites = await this.prisma.site.findMany({
      select: { id: true, name: true, nameKey: true },
      orderBy: { name: "asc" },
    });
    const basis = { questionCount: c.questionCount, lastSeq: c.messages.at(-1)?.seq ?? 0 };
    const mustSummarise = c.questionCount >= MAX_CONCERN_QUESTIONS;
    const { system } = buildConcernTurnPrompt({
      siteNames: sites.map((s) => s.name),
      assetTypes: CONCERN_ASSET_TYPES,
      questionCount: c.questionCount,
      mustSummarise,
    });
    const result = await this.ai.run("concern_turn", {
      system,
      messages: concernTranscript(c.messages),
      schema: concernTurnSchema(mustSummarise),
      schemaName: "concern_turn",
      maxTokens: TURN_MAX_TOKENS,
      timeoutMs: TURN_TIMEOUT_MS,
      actorUserId: actor.userId,
      object: { type: "ConcernConversation", id },
    });
    if (!result.ok) throw aiUnavailable(result.reason);
    const out = result.value;

    await this.prisma.$transaction(async (tx) => {
      const current = await this.lockOpen(tx, actor, id);
      const last = await tx.concernMessage.findFirst({
        where: { conversationId: id },
        orderBy: { seq: "desc" },
        select: { seq: true },
      });
      if (current.questionCount !== basis.questionCount || last?.seq !== basis.lastSeq) {
        throw overtaken();
      }
      const seq = basis.lastSeq + 1;
      if (out.kind === "question") {
        await tx.concernMessage.create({
          data: {
            conversationId: id,
            seq,
            role: "assistant",
            text: (out.question ?? "").trim(),
            chips: out.chips,
          },
        });
        await tx.concernConversation.update({
          where: { id },
          // A question after a summary makes that draft stale: it is never shown or submitted.
          data: { questionCount: { increment: 1 }, draft: Prisma.DbNull },
        });
        return;
      }
      if (!out.draft) throw new Error("A summary without a draft passed validation");
      const draft = draftFromSummary(out.draft, sites, current.toConfirm);
      await tx.concernMessage.create({
        data: { conversationId: id, seq, role: "assistant", text: "", chips: [] },
      });
      await tx.concernConversation.update({
        where: { id },
        data: { draft: { draft, interactionId: result.interactionId } },
      });
    });
  }
}
