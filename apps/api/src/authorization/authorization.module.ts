import { type DynamicModule, Module } from "@nestjs/common";
import type { Permission } from "@isms/contracts";
import { APP_GUARD } from "@nestjs/core";
import { PERMISSIONS_PROVIDER } from "../identity/index.js";
import { PolicyService } from "./policy.service.js";
import { AccessGuard, PermissionGuard } from "./require-permission.js";
import { DEFAULT_SCOPED_PERMISSIONS, SCOPED_PERMISSIONS } from "./scoped-permissions.js";

export type AuthorizationOptions = {
  /** Permissions evaluated per resource scope (P2-R10); defaults to none. */
  scopedPermissions?: readonly Permission[];
};

/**
 * Policy decisions and the global AccessGuard (AuthGuard, then PermissionGuard). Requires
 * IdentityModule (global) for AuthGuard and the shared CLOCK; provides PERMISSIONS_PROVIDER for /me. Without
 * this module no global guard is registered, so the app must import both (AppModule does).
 */
@Module({})
export class AuthorizationModule {
  static forRoot(options: AuthorizationOptions = {}): DynamicModule {
    const scoped = Object.freeze([...(options.scopedPermissions ?? DEFAULT_SCOPED_PERMISSIONS)]);
    return {
      module: AuthorizationModule,
      global: true,
      providers: [
        { provide: SCOPED_PERMISSIONS, useValue: scoped },
        PolicyService,
        { provide: PERMISSIONS_PROVIDER, useExisting: PolicyService },
        PermissionGuard,
        { provide: APP_GUARD, useClass: AccessGuard },
      ],
      exports: [PolicyService, PERMISSIONS_PROVIDER],
    };
  }
}
