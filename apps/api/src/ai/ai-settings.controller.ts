import { Body, Controller, HttpCode, Req } from "@nestjs/common";
import {
  type AiModelListResponse,
  type AiSettingsDto,
  type AiSettingsUpdateInput,
  type AiTestConnectionResponse,
  type SetAiKeyInput,
  aiSettingsRoutes,
} from "@isms/contracts";
import type { Request } from "express";
import { auditContextFrom } from "../audit/index.js";
import { type Actor, CurrentActor } from "../identity/index.js";
import { ContractRoute } from "../platform/index.js";
import { AiSettingsService } from "./ai-settings.service.js";

/** Settings → AI assistant. Administrators only; every write needs a recent sign-in. */
@Controller()
export class AiSettingsController {
  constructor(private readonly settings: AiSettingsService) {}

  @ContractRoute(aiSettingsRoutes.get)
  get(): Promise<AiSettingsDto> {
    return this.settings.get();
  }

  @ContractRoute(aiSettingsRoutes.setKey)
  setKey(
    @Body() body: SetAiKeyInput,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<AiSettingsDto> {
    return this.settings.setKey(body, actor.userId, auditContextFrom(req));
  }

  @ContractRoute(aiSettingsRoutes.removeKey)
  removeKey(@CurrentActor() actor: Actor, @Req() req: Request): Promise<AiSettingsDto> {
    return this.settings.removeKey(actor.userId, auditContextFrom(req));
  }

  @ContractRoute(aiSettingsRoutes.update)
  update(
    @Body() body: AiSettingsUpdateInput,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<AiSettingsDto> {
    return this.settings.update(body, actor.userId, auditContextFrom(req));
  }

  @ContractRoute(aiSettingsRoutes.listModels)
  listModels(): Promise<AiModelListResponse> {
    return this.settings.listModels();
  }

  @ContractRoute(aiSettingsRoutes.test)
  @HttpCode(200)
  test(@CurrentActor() actor: Actor, @Req() req: Request): Promise<AiTestConnectionResponse> {
    return this.settings.test(actor.userId, auditContextFrom(req));
  }
}
