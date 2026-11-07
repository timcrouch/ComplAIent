import { Body, Controller, HttpCode, Param, Query, Req } from "@nestjs/common";
import {
  type AddControlInput,
  type ApproveRiskInput,
  type DecideControlInput,
  type MyConcernsResponse,
  type RemoveControlInput,
  type RequestControlSuggestionsInput,
  type ReturnRiskInput,
  type ReportRiskInput,
  type RiskDetailDto,
  type RiskEditInput,
  type RiskListQuery,
  type RiskListResponse,
  type SubmitRiskInput,
  riskRoutes,
} from "@isms/contracts";
import type { Request } from "express";
import { auditContextFrom } from "../audit/index.js";
import { type Actor, CurrentActor } from "../identity/index.js";
import { ContractRoute } from "../platform/index.js";
import { ApprovalService } from "./approval.service.js";
import { RiskControlsService } from "./risk-controls.service.js";
import { RiskEditService } from "./risk-edit.service.js";
import { RiskQueryService } from "./risk-query.service.js";
import { RiskReportService } from "./risk-report.service.js";

/** Reporting, reading, editing, submitting and deciding risks. Visibility is decided per risk (§10). */
@Controller()
export class RisksController {
  constructor(
    private readonly reports: RiskReportService,
    private readonly query: RiskQueryService,
    private readonly edits: RiskEditService,
    private readonly controls: RiskControlsService,
    private readonly approvals: ApprovalService,
  ) {}

  @ContractRoute(riskRoutes.report)
  report(
    @Body() body: ReportRiskInput,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<RiskDetailDto> {
    return this.reports.report(actor, body, auditContextFrom(req));
  }

  @ContractRoute(riskRoutes.list)
  list(@Query() query: RiskListQuery, @CurrentActor() actor: Actor): Promise<RiskListResponse> {
    return this.query.list(actor, query);
  }

  @ContractRoute(riskRoutes.get)
  get(@Param("id") id: string, @CurrentActor() actor: Actor): Promise<RiskDetailDto> {
    return this.query.detail(actor, id);
  }

  @ContractRoute(riskRoutes.update)
  update(
    @Param("id") id: string,
    @Body() body: RiskEditInput,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<RiskDetailDto> {
    return this.edits.update(actor, id, body, auditContextFrom(req));
  }

  @ContractRoute(riskRoutes.requestSuggestions)
  @HttpCode(202)
  requestSuggestions(
    @Param("id") id: string,
    @Body() body: RequestControlSuggestionsInput,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<RiskDetailDto> {
    return this.controls.requestSuggestions(actor, id, body, auditContextFrom(req));
  }

  @ContractRoute(riskRoutes.decideControl)
  @HttpCode(200)
  decideControl(
    @Param("id") id: string,
    @Param("riskControlId") riskControlId: string,
    @Body() body: DecideControlInput,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<RiskDetailDto> {
    return this.controls.decide(actor, id, riskControlId, body, auditContextFrom(req));
  }

  @ContractRoute(riskRoutes.addControl)
  addControl(
    @Param("id") id: string,
    @Body() body: AddControlInput,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<RiskDetailDto> {
    return this.controls.add(actor, id, body, auditContextFrom(req));
  }

  @ContractRoute(riskRoutes.removeControl)
  removeControl(
    @Param("id") id: string,
    @Param("riskControlId") riskControlId: string,
    @Body() body: RemoveControlInput,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<RiskDetailDto> {
    return this.controls.remove(actor, id, riskControlId, body, auditContextFrom(req));
  }

  @ContractRoute(riskRoutes.submit)
  @HttpCode(200)
  submit(
    @Param("id") id: string,
    @Body() body: SubmitRiskInput,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<RiskDetailDto> {
    return this.approvals.submit(actor, id, body, auditContextFrom(req));
  }

  @ContractRoute(riskRoutes.approve)
  @HttpCode(200)
  approve(
    @Param("id") id: string,
    @Body() body: ApproveRiskInput,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<RiskDetailDto> {
    return this.approvals.approve(actor, id, body, auditContextFrom(req));
  }

  @ContractRoute(riskRoutes.return)
  @HttpCode(200)
  return(
    @Param("id") id: string,
    @Body() body: ReturnRiskInput,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<RiskDetailDto> {
    return this.approvals.return(actor, id, body, auditContextFrom(req));
  }

  @ContractRoute(riskRoutes.myConcerns)
  myConcerns(@CurrentActor() actor: Actor): Promise<MyConcernsResponse> {
    return this.query.myConcerns(actor);
  }
}
