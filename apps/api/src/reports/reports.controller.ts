import { Body, Controller, HttpCode, Param, Query, Req } from "@nestjs/common";
import {
  type ApproveNarrativeInput,
  type BoardNarrativeDto,
  type BoardPackResponse,
  type BoardQuery,
  type NarrativeDraftInput,
  type NarrativeDraftResponse,
  type RegisterQuery,
  type RegisterResponse,
  type SetApplicabilityInput,
  type SoaQuery,
  type SoaResponse,
  type SoaRowDto,
  reportRoutes,
} from "@isms/contracts";
import type { Request } from "express";
import { auditContextFrom } from "../audit/index.js";
import { type Actor, CurrentActor } from "../identity/index.js";
import { ContractRoute } from "../platform/index.js";
import { BoardService } from "./board.service.js";
import { NarrativeService } from "./narrative.service.js";
import { ReportsService } from "./reports.service.js";
import { SoaService } from "./soa.service.js";

/** The reports' data (§5): the register, the SoA and the board pack, scoped to the viewer. */
@Controller()
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly soaService: SoaService,
    private readonly boardService: BoardService,
    private readonly narrative: NarrativeService,
  ) {}

  @ContractRoute(reportRoutes.register)
  register(@Query() query: RegisterQuery, @CurrentActor() actor: Actor): Promise<RegisterResponse> {
    return this.reports.register(actor, query);
  }

  @ContractRoute(reportRoutes.soa)
  soa(@Query() query: SoaQuery, @CurrentActor() actor: Actor): Promise<SoaResponse> {
    return this.soaService.get(actor, query);
  }

  @ContractRoute(reportRoutes.setApplicability)
  setApplicability(
    @Param("requirementId") requirementId: string,
    @Body() body: SetApplicabilityInput,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<SoaRowDto> {
    return this.soaService.setApplicability(actor, requirementId, body, auditContextFrom(req));
  }

  @ContractRoute(reportRoutes.board)
  board(@Query() query: BoardQuery, @CurrentActor() actor: Actor): Promise<BoardPackResponse> {
    return this.boardService.get(actor, query);
  }

  @ContractRoute(reportRoutes.narrativeDraft)
  @HttpCode(200)
  narrativeDraft(
    @Body() body: NarrativeDraftInput,
    @CurrentActor() actor: Actor,
  ): Promise<NarrativeDraftResponse> {
    return this.narrative.draft(actor, body.period);
  }

  @ContractRoute(reportRoutes.approveNarrative)
  approveNarrative(
    @Body() body: ApproveNarrativeInput,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<BoardNarrativeDto> {
    return this.narrative.approve(actor, body, auditContextFrom(req));
  }
}
