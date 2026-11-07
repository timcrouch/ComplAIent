import { Controller, Query } from "@nestjs/common";
import { type RiskMapQuery, type RiskMapResponse, riskInsightRoutes } from "@isms/contracts";
import { type Actor, CurrentActor } from "../identity/index.js";
import { ContractRoute } from "../platform/index.js";
import { RiskInsightsService } from "./risk-insights.service.js";

/**
 * Registered before RisksController in the module, so `/risks/map` is matched ahead of
 * `/risks/{id}`.
 */
@Controller()
export class RiskInsightsController {
  constructor(private readonly insights: RiskInsightsService) {}

  @ContractRoute(riskInsightRoutes.map)
  map(@Query() query: RiskMapQuery, @CurrentActor() actor: Actor): Promise<RiskMapResponse> {
    return this.insights.map(actor, query.basis, query.includeClosed);
  }
}
