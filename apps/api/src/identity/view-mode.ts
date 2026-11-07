import type { Role, ViewMode } from "@isms/contracts";

const PROFESSIONAL_ROLES: ReadonlySet<Role> = new Set<Role>([
  "administrator",
  "ciso",
  "risk_owner",
  "risk_approver",
  "auditor",
]);

/** The view mode shown until the user chooses one (P2-R7). Presentation only. */
export function defaultViewMode(roles: readonly Role[]): ViewMode {
  return roles.some((role) => PROFESSIONAL_ROLES.has(role)) ? "professional" : "guided";
}
