import { Body, Controller, HttpCode, Param, Req } from "@nestjs/common";
import {
  type ControlOperationDto,
  type ControlTestDto,
  type ControlTestStepsResponse,
  type RecordControlTestInput,
  controlOperationRoutes,
} from "@isms/contracts";
import type { Request } from "express";
import { auditContextFrom } from "../audit/index.js";
import { type Actor, CurrentActor } from "../identity/index.js";
import { ContractRoute } from "../platform/index.js";
import { ControlOperationService } from "./control-operation.service.js";

/** Controls in operation, served under the library path. */
@Controller()
export class ControlOperationController {
  constructor(private readonly operation: ControlOperationService) {}

  @ContractRoute(controlOperationRoutes.operation)
  get(@Param("code") code: string, @CurrentActor() actor: Actor): Promise<ControlOperationDto> {
    return this.operation.operation(actor, code);
  }

  @ContractRoute(controlOperationRoutes.recordTest)
  recordTest(
    @Param("code") code: string,
    @Body() body: RecordControlTestInput,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<ControlTestDto> {
    return this.operation.recordTest(actor, code, body, auditContextFrom(req));
  }

  @ContractRoute(controlOperationRoutes.suggestTestSteps)
  @HttpCode(200)
  testSteps(
    @Param("code") code: string,
    @CurrentActor() actor: Actor,
  ): Promise<ControlTestStepsResponse> {
    return this.operation.testSteps(actor, code);
  }
}
