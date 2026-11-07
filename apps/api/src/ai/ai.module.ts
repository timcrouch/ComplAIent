import { type DynamicModule, Module } from "@nestjs/common";
import { AuditModule } from "../audit/index.js";
import { AiGatewayService } from "./ai-gateway.service.js";
import { AI_OPTIONS, type AiModuleOptions } from "./ai-options.js";
import { AiSettingsController } from "./ai-settings.controller.js";
import { AiSettingsService } from "./ai-settings.service.js";

/**
 * The AI gateway and its admin settings, global so feature modules (concerns) can inject
 * AiGatewayService. Needs the global IdentityModule (CLOCK) and PRISMA.
 */
@Module({})
export class AiModule {
  static forRoot(options: AiModuleOptions): DynamicModule {
    return {
      module: AiModule,
      global: true,
      imports: [AuditModule],
      controllers: [AiSettingsController],
      providers: [{ provide: AI_OPTIONS, useValue: options }, AiGatewayService, AiSettingsService],
      exports: [AiGatewayService],
    };
  }
}
