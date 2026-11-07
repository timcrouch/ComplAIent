import { Body, Controller, HttpCode, Param, Req } from "@nestjs/common";
import {
  type AddTreatmentActionInput,
  type CancelTaskInput,
  type CompleteTaskInput,
  type MyTaskDto,
  type TreatmentActionDto,
  treatmentRoutes,
} from "@isms/contracts";
import type { Request } from "express";
import { auditContextFrom } from "../audit/index.js";
import { type Actor, CurrentActor } from "../identity/index.js";
import { ContractRoute } from "../platform/index.js";
import { TreatmentService } from "./treatment.service.js";

/** Treatment actions on a risk, and completing or cancelling tasks. */
@Controller()
export class TreatmentController {
  constructor(private readonly treatment: TreatmentService) {}

  @ContractRoute(treatmentRoutes.addAction)
  addAction(
    @Param("id") id: string,
    @Body() body: AddTreatmentActionInput,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<TreatmentActionDto> {
    return this.treatment.addAction(actor, id, body, auditContextFrom(req));
  }

  @ContractRoute(treatmentRoutes.complete)
  @HttpCode(200)
  complete(
    @Param("id") id: string,
    @Body() body: CompleteTaskInput,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<MyTaskDto> {
    return this.treatment.complete(actor, id, body, auditContextFrom(req));
  }

  @ContractRoute(treatmentRoutes.cancel)
  @HttpCode(200)
  cancel(
    @Param("id") id: string,
    @Body() body: CancelTaskInput,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<TreatmentActionDto> {
    return this.treatment.cancel(actor, id, body, auditContextFrom(req));
  }
}
