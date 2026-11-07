import { Body, Controller, HttpCode, Param, Req } from "@nestjs/common";
import {
  type ConcernAiStatusDto,
  type ConcernReplyInput,
  type ConcernTranscriptDto,
  type ConversationDto,
  type ReportRiskInput,
  type RiskDetailDto,
  type StartConcernInput,
  concernRoutes,
} from "@isms/contracts";
import type { Request } from "express";
import { auditContextFrom } from "../audit/index.js";
import { type Actor, CurrentActor } from "../identity/index.js";
import { ContractRoute } from "../platform/index.js";
import { ConversationService } from "./conversation.service.js";
import { TranscriptService } from "./transcript.service.js";

/** Reporting a concern by conversation, and reading a reported concern's transcript. */
@Controller()
export class ConcernsController {
  constructor(
    private readonly conversations: ConversationService,
    private readonly transcripts: TranscriptService,
  ) {}

  // Declared before `/concerns/{id}` so "ai-status" is never taken for an id (PF8).
  @ContractRoute(concernRoutes.aiStatus)
  aiStatus(): Promise<ConcernAiStatusDto> {
    return this.conversations.aiStatus();
  }

  @ContractRoute(concernRoutes.start)
  start(
    @Body() body: StartConcernInput,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<ConversationDto> {
    return this.conversations.start(actor, body.text, auditContextFrom(req));
  }

  @ContractRoute(concernRoutes.reply)
  @HttpCode(200)
  reply(
    @Param("id") id: string,
    @Body() body: ConcernReplyInput,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<ConversationDto> {
    return this.conversations.reply(actor, id, body, auditContextFrom(req));
  }

  @ContractRoute(concernRoutes.get)
  get(@Param("id") id: string, @CurrentActor() actor: Actor): Promise<ConversationDto> {
    return this.conversations.get(actor, id);
  }

  @ContractRoute(concernRoutes.submit)
  submit(
    @Param("id") id: string,
    @Body() body: ReportRiskInput,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<RiskDetailDto> {
    return this.conversations.submit(actor, id, body, auditContextFrom(req));
  }

  @ContractRoute(concernRoutes.abandon)
  @HttpCode(200)
  abandon(
    @Param("id") id: string,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<ConversationDto> {
    return this.conversations.abandon(actor, id, auditContextFrom(req));
  }

  @ContractRoute(concernRoutes.transcript)
  transcript(@Param("id") id: string, @CurrentActor() actor: Actor): Promise<ConcernTranscriptDto> {
    return this.transcripts.forRisk(actor, id);
  }
}
