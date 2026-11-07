import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { RouteDef } from "@isms/contracts";
import { auditContextFrom } from "../audit/index.js";
import { CONTRACT_ROUTE } from "../platform/index.js";
import type { RequestWithActor } from "./actor.js";
import { JwtVerifier, unauthenticated } from "./jwt-verifier.js";
import { UserProvisioningService } from "./user-provisioning.service.js";

/** The only unauthenticated endpoints. openapi.json has no contract metadata (R12). */
export const PUBLIC_PATHS: ReadonlySet<string> = new Set([
  "/api/v1/health",
  "/api/v1/ready",
  "/api/v1/openapi.json",
]);

// Exactly "Bearer <token68>": case-sensitive scheme, one space, nothing after the token.
const BEARER = /^Bearer ([A-Za-z0-9\-._~+/]+=*)$/;

/** A route is public only if it has no permission and its path is exactly a public path. */
export function isPublicRoute(route: RouteDef | undefined, path: string): boolean {
  return route?.permission === undefined && PUBLIC_PATHS.has(path);
}

export function extractBearer(header: unknown): string | undefined {
  if (typeof header !== "string") return undefined;
  return BEARER.exec(header)?.[1];
}

/**
 * Default deny: every route needs a valid bearer token unless it has no
 * permission and its path is exactly one of PUBLIC_PATHS. Attaches `request.actor`.
 * Not registered globally itself: AuthorizationModule's AccessGuard runs it, then
 * PermissionGuard, so authentication always precedes authorization.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: JwtVerifier,
    private readonly provisioning: UserProvisioningService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") return false;
    const req = context.switchToHttp().getRequest<RequestWithActor>();
    const route = this.reflector.get<RouteDef | undefined>(CONTRACT_ROUTE, context.getHandler());
    if (isPublicRoute(route, req.path)) return true;

    const token = extractBearer(req.headers.authorization);
    if (token === undefined) throw unauthenticated();
    const verified = await this.verifier.verify(token);
    const { requestId, traceId } = auditContextFrom(req);
    req.actor = await this.provisioning.resolve(verified, {
      requestId,
      ...(traceId === undefined ? {} : { traceId }),
    });
    return true;
  }
}
