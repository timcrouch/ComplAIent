import {
  type CallHandler,
  Delete,
  type ExecutionContext,
  Get,
  Injectable,
  Logger,
  type NestInterceptor,
  Patch,
  Post,
  Put,
  SetMetadata,
  UseInterceptors,
  applyDecorators,
} from "@nestjs/common";
import { DomainError, type ErrorDetail } from "@isms/domain";
import type { RouteDef } from "@isms/contracts";
import type { Request, Response } from "express";
import { type Observable, map } from "rxjs";
import { UPLOAD_LIMITS_SETTING, type UploadLimits } from "./configure-app.js";
import { rawUpload } from "./raw-upload.js";
import { getRequestId } from "./request-id.js";
import { toErrorDetails, tryParse, validationFailed } from "./zod-pipe.js";

/** Metadata key under which the RouteDef is stored; read by the auth and permission guards. */
export const CONTRACT_ROUTE = "isms:contract-route";

export function toNestPath(openApiPath: string): string {
  return openApiPath.replace(/\{(\w+)\}/g, ":$1");
}

const methodDecorators = { get: Get, post: Post, put: Put, patch: Patch, delete: Delete };

const logger = new Logger("ContractRoute");

// Express 5 exposes req.query as a prototype getter, so shadow it on the instance.
function assign(req: Request, key: "params" | "query" | "body", value: unknown): void {
  Object.defineProperty(req, key, { value, configurable: true, writable: true, enumerable: true });
}

@Injectable()
class ContractInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const route = Reflect.getMetadata(CONTRACT_ROUTE, context.getHandler()) as RouteDef;

    // Validate everything before failing so the client sees all problems at once.
    const { params, query, body } = route.request ?? {};
    const parsed: ["params" | "query" | "body", unknown][] = [];
    const details: ErrorDetail[] = [];
    for (const [key, schema] of [
      ["params", params],
      ["query", query],
      ["body", body],
    ] as const) {
      if (!schema) continue;
      const outcome = tryParse(schema, req[key]);
      if (outcome.ok) parsed.push([key, outcome.data]);
      else details.push(...outcome.details);
    }
    if (details.length > 0) throw validationFailed(details);
    for (const [key, value] of parsed) assign(req, key, value);
    // An upload's body is the file itself, read later by the service (`RawUpload`).
    if (route.upload) {
      const limits = req.app.get(UPLOAD_LIMITS_SETTING) as UploadLimits | undefined;
      const limit = limits?.[route.upload.maxBytesConfig];
      if (limit === undefined) throw new DomainError("INTERNAL", "Upload limits not configured");
      assign(req, "body", rawUpload(req, limit));
    }

    // A download streams the file itself; there is no JSON payload to check.
    if (process.env["NODE_ENV"] === "production" || route.download) return next.handle();
    return next.handle().pipe(
      map((payload: unknown) => {
        const schema = route.responses[res.statusCode];
        if (!schema) return payload;
        const result = schema.safeParse(payload);
        if (result.success) return payload;
        logger.error({
          msg: "Response violates its contract",
          requestId: getRequestId(req),
          route: `${route.method.toUpperCase()} ${route.path}`,
          status: res.statusCode,
          issues: toErrorDetails(result.error.issues),
        });
        throw new DomainError("INTERNAL", "Response violates its contract");
      }),
    );
  }
}

/**
 * Binds a Nest handler to a contract: HTTP method and path, Zod validation of
 * params/query/body (parsed values replace the raw ones), a lazy `RawUpload` body on upload routes,
 * response validation outside production (not for downloads), and the RouteDef as metadata
 * for guards.
 */
export function ContractRoute(route: RouteDef): MethodDecorator {
  return applyDecorators(
    methodDecorators[route.method](toNestPath(route.path)),
    SetMetadata(CONTRACT_ROUTE, route),
    UseInterceptors(ContractInterceptor),
  );
}
