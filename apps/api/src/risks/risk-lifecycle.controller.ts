import { Body, Controller, HttpCode, Param, Req } from "@nestjs/common";
import {
  type CloseRiskInput,
  type ConfirmReviewInput,
  type ReassessRiskInput,
  type RiskDetailDto,
  riskLifecycleRoutes,
} from "@isms/contracts";
import type { Request } from "express";
import { auditContextFrom } from "../audit/index.js";
import { type Actor, CurrentActor } from "../identity/index.js";
import { ContractRoute } from "../platform/index.js";
import { RiskLifecycleService } from "./risk-lifecycle.service.js";

/** Mark as treated, reassess and confirm review. */
@Controller()
export class RiskLifecycleController {
  constructor(private readonly lifecycle: RiskLifecycleService) {}

  @ContractRoute(riskLifecycleRoutes.close)
  @HttpCode(200)
  close(
    @Param("id") id: string,
    @Body() body: CloseRiskInput,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<RiskDetailDto> {
    return this.lifecycle.close(actor, id, body, auditContextFrom(req));
  }

  @ContractRoute(riskLifecycleRoutes.reassess)
  @HttpCode(200)
  reassess(
    @Param("id") id: string,
    @Body() body: ReassessRiskInput,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<RiskDetailDto> {
    return this.lifecycle.reassess(actor, id, body, auditContextFrom(req));
  }

  @ContractRoute(riskLifecycleRoutes.confirmReview)
  @HttpCode(200)
  confirmReview(
    @Param("id") id: string,
    @Body() body: ConfirmReviewInput,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<RiskDetailDto> {
    return this.lifecycle.confirmReview(actor, id, body, auditContextFrom(req));
  }
}
