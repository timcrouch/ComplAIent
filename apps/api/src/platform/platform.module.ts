import { type DynamicModule, type ExecutionContext, Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { createLogger, loggerSerializers } from "@isms/telemetry";
import type { DestinationStream } from "pino";
import type { Request } from "express";
import { LoggerModule } from "nestjs-pino";
import { CallerThrottlerGuard, ipTracker, normaliseIp } from "./caller-throttler.guard.js";
import { GlobalErrorFilter } from "./error-filter.js";
import { resolveRequestId } from "./request-id.js";

export type PlatformOptions = {
  logLevel: string;
  service: string;
  /** Per-caller (bearer token hash, else IP) bucket. */
  rateLimitPerMinute: number;
  /** Per-IP bucket across all tokens; stops a caller rotating garbage bearers. */
  rateLimitPerIpPerMinute: number;
  /** IPs (the BFF) exempt from the per-IP bucket only. */
  throttleTrustedIps: string[];
  /** Log sink; defaults to stdout. Tests use it to capture output. */
  logDestination?: DestinationStream;
};

/** Probe and documentation endpoints are never throttled. */
const UNTHROTTLED_PATHS = new Set(["/api/v1/health", "/api/v1/ready", "/api/v1/openapi.json"]);
const pathOf = (req: { path?: string | undefined; url?: string | undefined }): string =>
  req.path ?? new URL(req.url ?? "/", "http://localhost").pathname;

const isProbe = (context: ExecutionContext): boolean =>
  UNTHROTTLED_PATHS.has(pathOf(context.switchToHttp().getRequest<Request>()));

const THROTTLE_TTL_MS = 60_000;

@Module({})
export class PlatformModule {
  static forRoot(options: PlatformOptions): DynamicModule {
    const trustedIps = new Set(options.throttleTrustedIps.map(normaliseIp));
    return {
      module: PlatformModule,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            logger: createLogger(
              { level: options.logLevel, service: options.service },
              options.logDestination,
            ),
            serializers: loggerSerializers,
            // The request-id middleware has already set req.id; this is only a fallback.
            genReqId: (req) => (typeof req.id === "string" ? req.id : resolveRequestId(undefined)),
            autoLogging: { ignore: (req) => pathOf(req) === "/api/v1/health" },
          },
        }),
        ThrottlerModule.forRoot({
          throttlers: [
            { name: "caller", ttl: THROTTLE_TTL_MS, limit: options.rateLimitPerMinute },
            {
              name: "ip",
              ttl: THROTTLE_TTL_MS,
              limit: options.rateLimitPerIpPerMinute,
              getTracker: (req) => ipTracker(req),
              // A per-throttler skipIf replaces the global one, so repeat the path check.
              skipIf: (context: ExecutionContext) => {
                const req = context.switchToHttp().getRequest<Request>();
                return isProbe(context) || trustedIps.has(normaliseIp(req.ip ?? ""));
              },
            },
          ],
          skipIf: isProbe,
        }),
      ],
      providers: [
        { provide: APP_FILTER, useClass: GlobalErrorFilter },
        { provide: APP_GUARD, useClass: CallerThrottlerGuard },
      ],
    };
  }
}
