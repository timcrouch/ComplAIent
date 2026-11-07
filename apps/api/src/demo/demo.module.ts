import { type DynamicModule, Module } from "@nestjs/common";
import { createPrismaClient } from "@isms/database";
import { createDefaultPorts } from "@isms/demo";
import { DemoController } from "./demo.controller.js";
import { DemoService } from "./demo.service.js";
import { DEMO_OPTIONS, DEMO_OWNER_DB, DEMO_PORTS, type DemoModuleOptions } from "./demo.tokens.js";

/**
 * Demo and training tools (spec §5.1). `register(null)` (demo mode off) is an empty module:
 * no routes, so every demo path is 404, and no owner connection. Needs the global
 * IdentityModule (CLOCK) and InfrastructureModule (PRISMA).
 */
@Module({})
export class DemoModule {
  static register(options: DemoModuleOptions | null): DynamicModule {
    if (options === null) return { module: DemoModule };
    return {
      module: DemoModule,
      controllers: [DemoController],
      providers: [
        { provide: DEMO_OPTIONS, useValue: options },
        // Prisma connects on first use, so this opens nothing until a reset or a load.
        { provide: DEMO_OWNER_DB, useFactory: () => createPrismaClient(options.ownerUrl) },
        {
          provide: DEMO_PORTS,
          useFactory: () => createDefaultPorts({ s3: options.storage, redisUrl: options.redisUrl }),
        },
        DemoService,
      ],
    };
  }
}
