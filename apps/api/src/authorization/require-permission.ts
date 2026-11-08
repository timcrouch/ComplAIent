import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Permission, RouteDef } from "@isms/contracts";
import { type Clock, DomainError } from "@isms/domain";
import {
  AuthGuard,
  CLOCK,
  type Actor,
  type RequestWithActor,
  isPublicRoute,
  unauthenticated,
} from "../identity/index.js";
import { CONTRACT_ROUTE } from "../platform/index.js";
import { ModuleGate } from "./module-gate.js";
import { PolicyService } from "./policy.service.js";
import { isRecentAuth, recentAuthRequired } from "./recent-auth.js";

export const forbidden = (): DomainError =>
  new DomainError("FORBIDDEN", "You don't have access to this");

/**
 * Enforces a contract route's `permission` (organisation level, or any scope for a scoped
 * permission; resource-scoped checks are made by services with PolicyService) and
 * `recentAuth`. The Clock is identity's CLOCK. Runs only after AuthGuard, through AccessGuard.
 * Public routes pass; any other route without an actor fails closed.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly policy: PolicyService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== "http") return false;
    const req = context.switchToHttp().getRequest<RequestWithActor>();
    const route = this.reflector.get<RouteDef | undefined>(CONTRACT_ROUTE, context.getHandler());
    if (isPublicRoute(route, req.path)) return true;

    const actor = req.actor;
    if (!actor) throw unauthenticated();
    if (route?.permission !== undefined && !this.allows(actor, route.permission)) {
      throw forbidden();
    }
    if (route?.recentAuth === true && !this.isRecent(actor)) throw recentAuthRequired();
    return true;
  }

  /**
   * A scoped permission (P2-R10) passes when held at any scope; the service then checks the
   * resource. Any other permission must be held at organisation scope (R19).
   */
  private allows(actor: Actor, permission: Permission): boolean {
    return this.policy.isScoped(permission)
      ? this.policy.canAtAnyScope(actor, permission)
      : this.policy.can(actor, permission);
  }

  /** Only a real auth_time can prove a recent sign-in; the iat fallback never does (R22). */
  private isRecent(actor: Actor): boolean {
    return actor.authTimeSource === "auth_time" && isRecentAuth(actor.authTime, this.clock.now());
  }
}

/**
 * The single global guard: authentication, then the module gate (an optional module that is
 * off answers 404), then authorization, in that fixed order. One composite guard makes the
 * order explicit instead of relying on APP_GUARD registration order across modules.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly auth: AuthGuard,
    private readonly modules: ModuleGate,
    private readonly permission: PermissionGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!(await this.auth.canActivate(context))) return false;
    await this.modules.check(context);
    return this.permission.canActivate(context);
  }
}
