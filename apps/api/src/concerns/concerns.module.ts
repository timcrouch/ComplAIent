import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/index.js";
import { RisksModule } from "../risks/index.js";
import { ConcernsController } from "./concerns.controller.js";
import { ConversationService } from "./conversation.service.js";
import { TranscriptService } from "./transcript.service.js";

/**
 * Concern conversations. Needs the global AiModule (AiGatewayService), AuthorizationModule
 * (PolicyService) and PRISMA.
 */
@Module({
  imports: [AuditModule, RisksModule],
  controllers: [ConcernsController],
  providers: [ConversationService, TranscriptService],
})
export class ConcernsModule {}
