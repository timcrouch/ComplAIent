import type { Permission, Role } from "@isms/contracts";

/**
 * What each role may do. Later plans extend these lists. The AI Act permissions (#16 §2) are
 * organisation-level only: they are not in DEFAULT_SCOPED_PERMISSIONS, so a site- or
 * department-scoped assignment does not grant them. risk_owner manages AI systems because a
 * system's owner is usually a business owner, not the CISO.
 */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = Object.freeze({
  administrator: [
    "me.read",
    "users.list",
    "roles.assign",
    "audit.read",
    "settings.ai.manage",
    "library.read",
    "organisation.manage",
    "risks.report",
    "ai.transcripts.read",
    "aiact.read",
  ],
  ciso: [
    "me.read",
    "users.list",
    "audit.read",
    "library.read",
    "library.review",
    "risks.report",
    "risks.read",
    "risks.review",
    "controls.test",
    "ai.transcripts.read",
    "reports.read",
    "reports.narrative",
    "soa.manage",
    "aiact.read",
    "aiact.manage",
    "concerns.judge",
  ],
  auditor: [
    "me.read",
    "audit.read",
    "library.read",
    "risks.read",
    "ai.transcripts.read",
    "reports.read",
    "aiact.read",
  ],
  risk_owner: [
    "me.read",
    "library.read",
    "risks.report",
    "risks.read",
    "risks.review",
    "controls.test",
    "aiact.read",
    "aiact.manage",
  ],
  risk_approver: [
    "me.read",
    "library.read",
    "risks.report",
    "risks.read",
    "risks.approve",
    "reports.read",
    "reports.narrative",
    "aiact.read",
  ],
  contributor: ["me.read", "risks.report"],
  viewer: ["me.read", "library.read", "risks.report", "risks.read", "aiact.read"],
});

/**
 * Held by every authenticated actor regardless of roles, so a user who has not yet been
 * assigned a role can still load their own profile (and see that they have no access), save
 * their own presentation preferences, and read the organisation's setup (P2-R14).
 */
export const BASELINE_PERMISSIONS: readonly Permission[] = Object.freeze([
  "me.read",
  "me.update",
  "organisation.read",
]);

/**
 * Permissions of a role as stored in the database. Unknown values (and prototype keys such
 * as "__proto__") grant nothing instead of throwing.
 */
export function permissionsOfRole(role: string): readonly Permission[] {
  return Object.hasOwn(ROLE_PERMISSIONS, role) ? ROLE_PERMISSIONS[role as Role] : [];
}
