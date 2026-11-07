import type { RoleAssignmentDto } from "@isms/contracts";
import type { Role, ScopeType } from "@isms/database";

const SCOPE: Record<ScopeType, RoleAssignmentDto["scope"]["type"]> = {
  ORGANISATION: "organisation",
  SITE: "site",
  DEPARTMENT: "department",
};

/** Maps a stored assignment (foreign-key scope columns) to its API shape. */
export function toRoleAssignmentDto(a: {
  role: Role;
  scopeType: ScopeType;
  siteId: string | null;
  departmentId: string | null;
}): RoleAssignmentDto {
  return {
    role: a.role,
    scope: { type: SCOPE[a.scopeType], id: a.siteId ?? a.departmentId ?? null },
  };
}
