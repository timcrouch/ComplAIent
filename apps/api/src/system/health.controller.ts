import { Controller, Get, Inject, Logger, Res } from "@nestjs/common";
import { allRoutes, buildOpenApiDocument, systemRoutes } from "@isms/contracts";
import type { Response } from "express";
import { ContractRoute } from "../platform/index.js";
import {
  CHECK_TIMEOUT_MS,
  type HealthIndicator,
  POSTGRES_HEALTH,
  REDIS_HEALTH,
  STORAGE_HEALTH,
  withTimeout,
} from "./health-indicators.js";

type CheckResult = "ok" | "fail";

@Controller()
export class HealthController {
  private readonly logger = new Logger(HealthController.name);
  private readonly indicators: HealthIndicator[];

  constructor(
    @Inject(POSTGRES_HEALTH) postgres: HealthIndicator,
    @Inject(REDIS_HEALTH) redis: HealthIndicator,
    @Inject(STORAGE_HEALTH) storage: HealthIndicator | null,
  ) {
    this.indicators = storage === null ? [postgres, redis] : [postgres, redis, storage];
  }

  @ContractRoute(systemRoutes.health)
  health(): { status: "ok" } {
    return { status: "ok" };
  }

  @ContractRoute(systemRoutes.ready)
  async ready(
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ status: CheckResult; checks: Record<string, CheckResult> }> {
    const outcomes = await Promise.all(
      this.indicators.map(async (indicator): Promise<[string, CheckResult]> => {
        try {
          // The indicator enforces its own timeout; this is a backstop for custom ones.
          await withTimeout(indicator.check(), CHECK_TIMEOUT_MS);
          return [indicator.name, "ok"];
        } catch (err) {
          this.logger.warn({
            msg: "Readiness check failed",
            check: indicator.name,
            reason: err instanceof Error ? err.message : "unknown",
          });
          return [indicator.name, "fail"];
        }
      }),
    );
    const checks = Object.fromEntries(outcomes);
    const healthy = outcomes.every(([, result]) => result === "ok");
    if (!healthy) res.status(503);
    return { status: healthy ? "ok" : "fail", checks };
  }
}

@Controller()
export class OpenApiController {
  private readonly document = buildOpenApiDocument(allRoutes);

  /** Plain route, not a contract route: the document describes the contracts. */
  @Get("/api/v1/openapi.json")
  openapi(): unknown {
    return this.document;
  }
}
