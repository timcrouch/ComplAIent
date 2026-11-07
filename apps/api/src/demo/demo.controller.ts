import { Body, Controller, HttpCode } from "@nestjs/common";
import {
  type DemoConfirmInput,
  type DemoLoadResponse,
  type DemoStatusResponse,
  demoRoutes,
} from "@isms/contracts";
import { type Actor, CurrentActor } from "../identity/index.js";
import { ContractRoute } from "../platform/index.js";
import { DemoService } from "./demo.service.js";

/** Registered only when demo mode is on; otherwise these paths do not exist (404). */
@Controller()
export class DemoController {
  constructor(private readonly demo: DemoService) {}

  @ContractRoute(demoRoutes.status)
  status(): Promise<DemoStatusResponse> {
    return this.demo.status();
  }

  @ContractRoute(demoRoutes.loadSample)
  @HttpCode(200)
  loadSample(
    @Body() body: DemoConfirmInput,
    @CurrentActor() actor: Actor,
  ): Promise<DemoLoadResponse> {
    return this.demo.loadSample(body, actor);
  }

  @ContractRoute(demoRoutes.reset)
  @HttpCode(204)
  async reset(@Body() body: DemoConfirmInput, @CurrentActor() actor: Actor): Promise<void> {
    await this.demo.reset(body, actor);
  }
}
