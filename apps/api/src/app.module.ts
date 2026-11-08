import { Module } from "@nestjs/common";
import { AiModule } from "./ai/index.js";
import { AuthorizationModule } from "./authorization/index.js";
import { ConcernsModule } from "./concerns/index.js";
import type { AppConfig } from "./config.js";
import { DemoModule, type DemoModuleOptions } from "./demo/index.js";
import { EvidenceModule } from "./evidence/index.js";
import { IdentityModule } from "./identity/index.js";
import { LibraryModule } from "./library/index.js";
import { OrganisationModule } from "./organisation/index.js";
import { InfrastructureModule, PlatformModule } from "./platform/index.js";
import { ReportsModule } from "./reports/index.js";
import { RisksModule } from "./risks/index.js";
import { SystemModule } from "./system/index.js";
import { WorkspaceModule } from "./workspace/index.js";

/** The demo module's settings when demo mode is on (config parsing made them required). */
function demoOptions(config: AppConfig): DemoModuleOptions | null {
  if (config.demo === null) return null;
  const bootstrapAdminEmail = config.BOOTSTRAP_ADMIN_EMAIL;
  if (bootstrapAdminEmail === undefined) throw new Error("BOOTSTRAP_ADMIN_EMAIL missing");
  return {
    ownerUrl: config.demo.ownerUrl,
    bootstrapAdminEmail,
    storage: config,
    redisUrl: config.REDIS_URL,
  };
}

@Module({})
export class AppModule {
  static forRoot(config: AppConfig) {
    return {
      module: AppModule,
      imports: [
        PlatformModule.forRoot({
          logLevel: config.LOG_LEVEL,
          service: "isms-api",
          rateLimitPerMinute: config.RATE_LIMIT_PER_MINUTE,
          rateLimitPerIpPerMinute: config.RATE_LIMIT_PER_IP_PER_MINUTE,
          throttleTrustedIps: config.THROTTLE_TRUSTED_IPS,
        }),
        InfrastructureModule.forRoot({
          databaseUrl: config.DATABASE_URL,
          redisUrl: config.REDIS_URL,
        }),
        SystemModule,
        IdentityModule.forRoot({
          issuer: config.OIDC_ISSUER_URL,
          audience: config.OIDC_AUDIENCE,
          accessTokenTyp: config.OIDC_ACCESS_TOKEN_TYP,
          bootstrapAdminEmail: config.BOOTSTRAP_ADMIN_EMAIL,
          demoTools: config.demo !== null,
        }),
        AuthorizationModule.forRoot(),
        LibraryModule,
        OrganisationModule,
        RisksModule,
        AiModule.forRoot({
          secretsKey: config.AI_SECRETS_KEY,
          provider: config.AI_PROVIDER,
          allowNonEuRouting: config.AI_ALLOW_NON_EU_ROUTING,
        }),
        ConcernsModule,
        EvidenceModule.forRoot({ storage: config }),
        WorkspaceModule,
        ReportsModule,
        // Demo mode off: an empty module (no routes, no owner connection).
        DemoModule.register(demoOptions(config)),
      ],
    };
  }
}
