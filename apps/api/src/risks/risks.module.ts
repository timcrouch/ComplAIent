import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/index.js";
import { OrganisationModule } from "../organisation/index.js";
import { ControlOperationController } from "./control-operation.controller.js";
import { ControlOperationService } from "./control-operation.service.js";
import { ApprovalService } from "./approval.service.js";
import { RiskControlsService } from "./risk-controls.service.js";
import { RiskEditService } from "./risk-edit.service.js";
import { RiskInsightsController } from "./risk-insights.controller.js";
import { RiskInsightsService } from "./risk-insights.service.js";
import { RiskLifecycleController } from "./risk-lifecycle.controller.js";
import { RiskLifecycleService } from "./risk-lifecycle.service.js";
import { RiskQueryService } from "./risk-query.service.js";
import { RiskReportService } from "./risk-report.service.js";
import { RisksController } from "./risks.controller.js";
import { TreatmentController } from "./treatment.controller.js";
import { TreatmentService } from "./treatment.service.js";
import { ConcernRewardsService } from "./concern-rewards.service.js";
import { ConcernEvaluationController } from "./concern-evaluation.controller.js";
import { ConcernEvaluationService } from "./concern-evaluation.service.js";

/** The risk API. Needs the global AuthorizationModule (PolicyService) and PRISMA. */
@Module({
  imports: [AuditModule, OrganisationModule],
  controllers: [
    ControlOperationController,
    RiskInsightsController,
    RiskLifecycleController,
    RisksController,
    TreatmentController,
    ConcernEvaluationController,
  ],
  providers: [
    ControlOperationService,
    RiskQueryService,
    RiskReportService,
    RiskEditService,
    RiskControlsService,
    ApprovalService,
    RiskInsightsService,
    RiskLifecycleService,
    TreatmentService,
    ConcernRewardsService,
    ConcernEvaluationService,
  ],
  exports: [
    RiskQueryService,
    RiskReportService,
    RiskEditService,
    RiskControlsService,
    ApprovalService,
    RiskInsightsService,
    RiskLifecycleService,
    TreatmentService,
  ],
})
export class RisksModule {}
