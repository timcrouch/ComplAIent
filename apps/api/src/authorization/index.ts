export { AuthorizationModule } from "./authorization.module.js";
export type { AuthorizationOptions } from "./authorization.module.js";
export { PolicyService } from "./policy.service.js";
export type { AccessScope, ResourceScope } from "./policy.service.js";
export { DEFAULT_SCOPED_PERMISSIONS, SCOPED_PERMISSIONS } from "./scoped-permissions.js";
export { RECENT_AUTH_WINDOW_S, isRecentAuth, recentAuthRequired } from "./recent-auth.js";
export { AccessGuard, PermissionGuard, forbidden } from "./require-permission.js";
export { BASELINE_PERMISSIONS, ROLE_PERMISSIONS, permissionsOfRole } from "./roles.js";
