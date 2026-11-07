import type { RoleAssignmentDto } from "@isms/contracts";
import { Prisma } from "@isms/database";
import type { Actor } from "../identity/index.js";

/** Roles that see every risk in their scope, whatever its state. */
const FULL_SIGHT: ReadonlySet<string> = new Set(["ciso", "risk_owner", "risk_approver", "auditor"]);

/** One way to see a risk: every named column must equal the value. */
type Grant = {
  reporterId?: string;
  ownerId?: string;
  siteId?: string;
  departmentId?: string;
  states?: readonly ("approved" | "closed")[];
};

const isId = (id: string | null): id is string => typeof id === "string" && id.length > 0;

/** The scope part of a grant; null for an unusable scope (it grants nothing). */
function scopeGrant(scope: RoleAssignmentDto["scope"]): Grant | null {
  switch (scope.type) {
    case "organisation":
      return {};
    case "site":
      return isId(scope.id) ? { siteId: scope.id } : null;
    case "department":
      return isId(scope.id) ? { departmentId: scope.id } : null;
    default:
      return null;
  }
}

/**
 * The ways an actor may see risks (spec §10), or "all":
 * - their own reports and the risks they own, always;
 * - every risk in the scope of a ciso, risk_owner, risk_approver or auditor assignment;
 * - approved and closed risks in the scope of a viewer assignment.
 * Contributor and administrator assignments add nothing.
 */
function visibilityGrants(actor: Actor): Grant[] | "all" {
  const grants: Grant[] = [{ reporterId: actor.userId }, { ownerId: actor.userId }];
  for (const assignment of actor.roles) {
    const full = FULL_SIGHT.has(assignment.role);
    if (!full && assignment.role !== "viewer") continue;
    const scope = scopeGrant(assignment.scope);
    if (scope === null) continue;
    if (full && assignment.scope.type === "organisation") return "all";
    grants.push(full ? scope : { ...scope, states: ["approved", "closed"] });
  }
  return grants;
}

/** The risks an actor may see, as a Prisma where clause. */
export function riskVisibilityWhere(actor: Actor): Prisma.RiskWhereInput {
  const grants = visibilityGrants(actor);
  if (grants === "all") return {};
  return {
    OR: grants.map(({ states, ...columns }) =>
      states ? { ...columns, state: { in: [...states] } } : columns,
    ),
  };
}

/** Column and cast of each grant field (a fixed list, never caller input). */
const COLUMNS: Record<keyof Grant, Prisma.Sql> = {
  reporterId: Prisma.sql`r."reporterId" =`,
  ownerId: Prisma.sql`r."ownerId" =`,
  siteId: Prisma.sql`r."siteId" =`,
  departmentId: Prisma.sql`r."departmentId" =`,
  states: Prisma.sql`r."state" IN`,
};

/**
 * The same rule as `riskVisibilityWhere`, as a SQL condition on the alias `r` of "Risk",
 * for raw queries. Both are built from `visibilityGrants`, so they cannot disagree.
 */
export function riskVisibilitySql(actor: Actor): Prisma.Sql {
  const grants = visibilityGrants(actor);
  if (grants === "all") return Prisma.sql`TRUE`;
  const terms = grants.map((grant) => {
    const parts = (Object.entries(grant) as [keyof Grant, string | readonly string[]][]).map(
      ([field, value]) =>
        field === "states"
          ? Prisma.sql`r."state" IN (${Prisma.join((value as readonly string[]).map((v) => Prisma.sql`${v}::"RiskState"`))})`
          : Prisma.sql`${COLUMNS[field]} ${value as string}::uuid`,
    );
    return Prisma.sql`(${Prisma.join(parts, " AND ")})`;
  });
  return Prisma.sql`(${Prisma.join(terms, " OR ")})`;
}
