import { Body, Controller, HttpCode, Param, Req } from "@nestjs/common";
import {
  type ConcernEvaluationDto,
  type ConcernEvaluationQueueDto,
  type JudgeConcernInput,
  type SecurityContributionDto,
  concernRewardRoutes,
} from "@isms/contracts";
import type { Request } from "express";
import { auditContextFrom } from "../audit/index.js";
import { type Actor, CurrentActor } from "../identity/index.js";
import { ContractRoute } from "../platform/index.js";
import { ConcernEvaluationService } from "./concern-evaluation.service.js";

@Controller()
export class ConcernEvaluationController {
  constructor(private readonly evaluations: ConcernEvaluationService) {}

  @ContractRoute(concernRewardRoutes.contribution)
  contribution(@CurrentActor() actor: Actor): Promise<SecurityContributionDto> {
    return this.evaluations.contribution(actor);
  }

  @ContractRoute(concernRewardRoutes.queue)
  queue(): Promise<ConcernEvaluationQueueDto> {
    return this.evaluations.queue();
  }

  @ContractRoute(concernRewardRoutes.get)
  get(@Param("id") id: string, @CurrentActor() actor: Actor): Promise<ConcernEvaluationDto> {
    return this.evaluations.get(actor, id);
  }

  @ContractRoute(concernRewardRoutes.judge)
  @HttpCode(200)
  judge(
    @Param("id") id: string,
    @Body() body: JudgeConcernInput,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<ConcernEvaluationDto> {
    return this.evaluations.judge(actor, id, body, auditContextFrom(req));
  }
}
