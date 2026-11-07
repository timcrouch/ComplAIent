import type { Permission } from "@isms/contracts";

/**
 * DI token for the permissions evaluated per resource scope (P2-R10). For these, the route
 * guard accepts the permission held at any scope, the service checks the resource
 * (`PolicyService.assertCanAccess`), and `permissionsFor` reports it.
 */
export const SCOPED_PERMISSIONS = Symbol("SCOPED_PERMISSIONS");

/**
 * The risk permissions (P3-R1) and transcript reading are evaluated against the risk's site or
 * department. `controls.test` is deliberately not here (#24): a test sets the organisation-wide
 * SoA status and library result, so only organisation-scoped holders may record one. `risks.report` is here so a site- or department-scoped holder passes the
 * route guard; reporting itself is not restricted by unit (a scoped contributor may report
 * about any site). `library.read` (P6-R5) is here only so scoped holders pass the guard: library
 * data is organisation-wide. `reports.read` (P7) is here so scoped holders pass the guard; the
 * reports service scopes the figures to the holder's sites and departments.
 */
export const DEFAULT_SCOPED_PERMISSIONS: readonly Permission[] = Object.freeze([
  "risks.report",
  "risks.read",
  "risks.review",
  "risks.approve",
  "ai.transcripts.read",
  "library.read",
  "reports.read",
]);
