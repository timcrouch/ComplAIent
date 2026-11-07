import { Inject, Injectable, Optional } from "@nestjs/common";
import type { Permission, RoleAssignmentDto } from "@isms/contracts";
import { DomainError } from "@isms/domain";
import type { Actor, PermissionsProvider } from "../identity/index.js";
import { BASELINE_PERMISSIONS, permissionsOfRole } from "./roles.js";
import { DEFAULT_SCOPED_PERMISSIONS, SCOPED_PERMISSIONS } from "./scoped-permissions.js";

/** The organisational unit a resource belongs to. */
export type ResourceScope = { siteId?: string; departmentId?: string };

/** Where an actor may use a permission: everywhere, only in some units, or nowhere. */
export type AccessScope =
  | { kind: "organisation" }
  | { kind: "units"; siteIds: string[]; departmentIds: string[] }
  | { kind: "none" };

/** A usable unit id: null, undefined and the empty string never match anything. */
const isId = (id: string | null | undefined): id is string =>
  typeof id === "string" && id.length > 0;

/**
 * Organisation scope matches any resource (and the no-resource case). Site and department
 * scopes match only a resource in that exact unit (no hierarchy). Unknown scope types and
 * empty or null ids match nothing.
 */
function scopeMatches(scope: RoleAssignmentDto["scope"], resource?: ResourceScope): boolean {
  switch (scope.type) {
    case "organisation":
      return true;
    case "site":
      return isId(scope.id) && isId(resource?.siteId) && resource.siteId === scope.id;
    case "department":
      return isId(scope.id) && isId(resource?.departmentId) && resource.departmentId === scope.id;
    default:
      return false;
  }
}

/**
 * True for a scope that can match something: organisation, or a site or department with a
 * usable id. Unknown scope types from the database are not usable.
 */
function isUsableScope(scope: RoleAssignmentDto["scope"]): boolean {
  switch (scope.type) {
    case "organisation":
      return true;
    case "site":
    case "department":
      return isId(scope.id);
    default:
      return false;
  }
}

/** Role- and scope-based authorization decisions. Deny unless an assignment grants it. */
@Injectable()
export class PolicyService implements PermissionsProvider {
  private readonly scoped: ReadonlySet<Permission>;

  constructor(
    @Optional()
    @Inject(SCOPED_PERMISSIONS)
    scopedPermissions: readonly Permission[] = DEFAULT_SCOPED_PERMISSIONS,
  ) {
    this.scoped = new Set(scopedPermissions);
  }

  /** Whether `permission` is evaluated per resource scope (P2-R10). */
  isScoped(permission: Permission): boolean {
    return this.scoped.has(permission);
  }

  can(actor: Actor, permission: Permission, resource?: ResourceScope): boolean {
    return this.grants(actor.roles, permission, resource);
  }

  /**
   * The rule of `can` for a set of assignments rather than the caller, for questions about
   * other users (for example, who may approve a risk). Assignments are read per request, so a
   * revoked role counts for nothing at once.
   */
  grants(
    roles: readonly RoleAssignmentDto[],
    permission: Permission,
    resource?: ResourceScope,
  ): boolean {
    if (BASELINE_PERMISSIONS.includes(permission)) return true;
    return roles.some(
      (a) => permissionsOfRole(a.role).includes(permission) && scopeMatches(a.scope, resource),
    );
  }

  /** True if any one assignment, at any usable scope, carries the permission. */
  canAtAnyScope(actor: Actor, permission: Permission): boolean {
    if (BASELINE_PERMISSIONS.includes(permission)) return true;
    return actor.roles.some(
      (a) => permissionsOfRole(a.role).includes(permission) && isUsableScope(a.scope),
    );
  }

  /**
   * Where the actor may use `permission`, for services that filter lists: organisation when
   * an organisation-scoped assignment (or the baseline) grants it, otherwise the distinct
   * site and department ids of the assignments that carry it, otherwise none.
   */
  accessScope(actor: Actor, permission: Permission): AccessScope {
    if (this.can(actor, permission)) return { kind: "organisation" };
    const siteIds = new Set<string>();
    const departmentIds = new Set<string>();
    for (const a of actor.roles) {
      if (!permissionsOfRole(a.role).includes(permission) || !isId(a.scope.id)) continue;
      if (a.scope.type === "site") siteIds.add(a.scope.id);
      else if (a.scope.type === "department") departmentIds.add(a.scope.id);
    }
    if (siteIds.size === 0 && departmentIds.size === 0) return { kind: "none" };
    return { kind: "units", siteIds: [...siteIds], departmentIds: [...departmentIds] };
  }

  /**
   * The service-level check for one stored resource. Refuses with 404 NOT_FOUND, not 403, so
   * that a response never reveals that a resource outside the actor's units exists.
   */
  assertCanAccess(actor: Actor, permission: Permission, resource: ResourceScope): void {
    if (!this.can(actor, permission, resource)) throw new DomainError("NOT_FOUND", "Not found");
  }

  /**
   * Exactly what the route guard grants (Ruling R21, P2-R10): the baseline, the permissions
   * of organisation-scoped assignments, and each scoped permission held at any scope, without
   * duplicates. An unscoped permission held only through a site or department assignment is
   * not reported (the assignment stays visible in `MeResponse.roles`).
   */
  permissionsFor(actor: Actor): Permission[] {
    const all = new Set<Permission>(BASELINE_PERMISSIONS);
    for (const a of actor.roles) {
      if (!isUsableScope(a.scope)) continue;
      for (const p of permissionsOfRole(a.role)) {
        if (a.scope.type === "organisation" || this.scoped.has(p)) all.add(p);
      }
    }
    return [...all];
  }
}
