import { Body, Controller, HttpCode, Param, Req } from "@nestjs/common";
import {
  type AiClassificationDraftResponse,
  type AiObligationGuidanceResponse,
  type AiSystemDetailDto,
  type AiSystemInput,
  type AiSystemListResponse,
  type AiSystemUpdateInput,
  type ClassifyAiSystemInput,
  type LinkAiSystemRiskInput,
  type UpdateAiObligationInput,
  aiActRoutes,
} from "@isms/contracts";
import type { AiObligationKey } from "@isms/domain";
import type { Request } from "express";
import { auditContextFrom } from "../audit/index.js";
import { type Actor, CurrentActor } from "../identity/index.js";
import { ContractRoute } from "../platform/index.js";
import { AiActAssistService } from "./ai-act-assist.service.js";
import { AiSystemClassificationService } from "./ai-system-classification.service.js";
import { AiSystemRisksService } from "./ai-system-risks.service.js";
import { AiSystemsService } from "./ai-systems.service.js";

/** The EU AI Act module's routes; all 404 while the module is off (`RouteDef.module`). */
@Controller()
export class AiSystemsController {
  constructor(
    private readonly systems: AiSystemsService,
    private readonly classification: AiSystemClassificationService,
    private readonly risks: AiSystemRisksService,
    private readonly assist: AiActAssistService,
  ) {}

  @ContractRoute(aiActRoutes.listSystems)
  list(): Promise<AiSystemListResponse> {
    return this.systems.list();
  }

  @ContractRoute(aiActRoutes.createSystem)
  create(
    @Body() body: AiSystemInput,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<AiSystemDetailDto> {
    return this.systems.create(actor, body, auditContextFrom(req));
  }

  @ContractRoute(aiActRoutes.getSystem)
  get(@Param("id") id: string, @CurrentActor() actor: Actor): Promise<AiSystemDetailDto> {
    return this.systems.get(actor, id);
  }

  @ContractRoute(aiActRoutes.updateSystem)
  update(
    @Param("id") id: string,
    @Body() body: AiSystemUpdateInput,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<AiSystemDetailDto> {
    return this.systems.update(actor, id, body, auditContextFrom(req));
  }

  @ContractRoute(aiActRoutes.classify)
  classify(
    @Param("id") id: string,
    @Body() body: ClassifyAiSystemInput,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<AiSystemDetailDto> {
    return this.classification.classify(actor, id, body, auditContextFrom(req));
  }

  @ContractRoute(aiActRoutes.draftClassification)
  @HttpCode(200)
  draft(
    @Param("id") id: string,
    @CurrentActor() actor: Actor,
  ): Promise<AiClassificationDraftResponse> {
    return this.assist.draftClassification(actor, id);
  }

  @ContractRoute(aiActRoutes.updateObligation)
  updateObligation(
    @Param("id") id: string,
    @Param("key") key: AiObligationKey,
    @Body() body: UpdateAiObligationInput,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<AiSystemDetailDto> {
    return this.classification.updateObligation(actor, id, key, body, auditContextFrom(req));
  }

  @ContractRoute(aiActRoutes.obligationGuidance)
  @HttpCode(200)
  guidance(
    @Param("id") id: string,
    @Param("key") key: AiObligationKey,
    @CurrentActor() actor: Actor,
  ): Promise<AiObligationGuidanceResponse> {
    return this.assist.obligationGuidance(actor, id, key);
  }

  @ContractRoute(aiActRoutes.linkRisk)
  link(
    @Param("id") id: string,
    @Body() body: LinkAiSystemRiskInput,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<AiSystemDetailDto> {
    return this.risks.link(actor, id, body.riskId, auditContextFrom(req));
  }

  @ContractRoute(aiActRoutes.unlinkRisk)
  unlink(
    @Param("id") id: string,
    @Param("riskId") riskId: string,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<AiSystemDetailDto> {
    return this.risks.unlink(actor, id, riskId, auditContextFrom(req));
  }
}
