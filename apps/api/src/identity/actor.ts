import { type ExecutionContext, createParamDecorator } from "@nestjs/common";
import type { RoleAssignmentDto } from "@isms/contracts";
import type { Request } from "express";
import { type AuthTimeSource, unauthenticated } from "./jwt-verifier.js";

/** The authenticated caller, attached to the request by AuthGuard. */
export type Actor = {
  userId: string;
  email: string;
  /** Epoch seconds of the last interactive sign-in. */
  authTime: number;
  /** Only "auth_time" can satisfy a recent-authentication check. */
  authTimeSource: AuthTimeSource;
  roles: RoleAssignmentDto[];
};

export type RequestWithActor = Request & { actor?: Actor };

/** Handler parameter decorator for the authenticated actor; fails closed if absent. */
export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor => {
  const actor = ctx.switchToHttp().getRequest<RequestWithActor>().actor;
  if (!actor) throw unauthenticated();
  return actor;
});
