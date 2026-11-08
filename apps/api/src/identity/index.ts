export { CurrentActor } from "./actor.js";
export type { Actor, RequestWithActor } from "./actor.js";
export { AuthGuard, PUBLIC_PATHS, extractBearer, isPublicRoute } from "./auth.guard.js";
export { CLOCK, IdentityModule } from "./identity.module.js";
export type { IdentityOptions } from "./identity.module.js";
export { JwtVerifier, unauthenticated } from "./jwt-verifier.js";
export type { AuthTimeSource, JwtVerifierOptions, VerifiedToken } from "./jwt-verifier.js";
export { PERMISSIONS_PROVIDER } from "./permissions.js";
export type { PermissionsProvider } from "./permissions.js";
export { RoleAssignmentService } from "./role-assignment.service.js";
export { toRoleAssignmentDto } from "./role-scope.js";
export {
  BOOTSTRAP_ADMIN_LOCK,
  DEMO_LOCK,
  UserProvisioningService,
} from "./user-provisioning.service.js";
