import { type DynamicModule, Module } from "@nestjs/common";
import { type Clock, systemClock } from "@isms/domain";
import { AuditModule } from "../audit/index.js";
import { AuthGuard } from "./auth.guard.js";
import { JwtVerifier } from "./jwt-verifier.js";
import { MeController } from "./me.controller.js";
import { RoleAssignmentService } from "./role-assignment.service.js";
import { UsersController } from "./users.controller.js";
import {
  PROVISIONING_OPTIONS,
  type ProvisioningOptions,
  UserProvisioningService,
} from "./user-provisioning.service.js";

/**
 * The one Clock for authentication and authorization (token expiry, future auth_time,
 * recent-auth), so the two can never disagree about the time.
 */
export const CLOCK = Symbol("CLOCK");

export type IdentityOptions = {
  issuer: string;
  audience: string;
  bootstrapAdminEmail?: string | undefined;
  /** Demo mode (DEMO_TOOLS_ENABLED); off unless set. */
  demoTools?: boolean;
  clock?: Clock;
};

/**
 * Token verification, user provisioning, /me, and the users and role-assignment routes.
 * Global so AuthorizationModule can run AuthGuard inside its AccessGuard; /me needs
 * PERMISSIONS_PROVIDER from AuthorizationModule.
 */
@Module({})
export class IdentityModule {
  static forRoot(options: IdentityOptions): DynamicModule {
    const clock = options.clock ?? systemClock;
    const provisioning: ProvisioningOptions = {
      bootstrapAdminEmail: options.bootstrapAdminEmail,
      clock,
      demoTools: options.demoTools ?? false,
    };
    return {
      module: IdentityModule,
      global: true,
      imports: [AuditModule],
      controllers: [MeController, UsersController],
      providers: [
        {
          provide: JwtVerifier,
          useFactory: () =>
            new JwtVerifier({ issuer: options.issuer, audience: options.audience, clock }),
        },
        { provide: CLOCK, useValue: clock },
        { provide: PROVISIONING_OPTIONS, useValue: provisioning },
        UserProvisioningService,
        RoleAssignmentService,
        AuthGuard,
      ],
      exports: [UserProvisioningService, AuthGuard, CLOCK],
    };
  }
}
