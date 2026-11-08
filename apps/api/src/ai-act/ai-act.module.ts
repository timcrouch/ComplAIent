import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/index.js";
import { AiActAssistService } from "./ai-act-assist.service.js";
import { AiSystemClassificationService } from "./ai-system-classification.service.js";
import { AiSystemReader } from "./ai-system-reader.js";
import { AiSystemRisksService } from "./ai-system-risks.service.js";
import { AiSystemsController } from "./ai-systems.controller.js";
import { AiSystemsService } from "./ai-systems.service.js";

/**
 * The EU AI Act module (#16): the AI system register, classification, obligations, risk links
 * and AI assistance. Always registered; its routes answer 404 while the module is off (the
 * global AccessGuard's ModuleGate). Needs the global AuthorizationModule, AiModule, CLOCK and
 * PRISMA.
 */
@Module({
  imports: [AuditModule],
  controllers: [AiSystemsController],
  providers: [
    AiSystemReader,
    AiSystemsService,
    AiSystemClassificationService,
    AiSystemRisksService,
    AiActAssistService,
  ],
})
export class AiActModule {}
