import { z } from "zod";
import "../zod.js";
import { ErrorResponse } from "../errors.js";
import { RoleSchema } from "../permissions.js";
import { defineRoute } from "../route.js";

/** Where a role applies: the whole organisation, or one site or department. */
export const ScopeInput = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("organisation"), id: z.null() }),
    z.object({ type: z.literal("site"), id: z.uuid() }),
    z.object({ type: z.literal("department"), id: z.uuid() }),
  ])
  .openapi("ScopeInput");
export type ScopeInput = z.infer<typeof ScopeInput>;

export const RoleAssignmentDetailDto = z
  .object({
    id: z.string(),
    userId: z.string(),
    role: RoleSchema,
    scope: z.object({
      type: z.enum(["organisation", "site", "department"]),
      id: z.string().nullable(),
    }),
    /** The site or department name; null for organisation scope. */
    scopeName: z.string().nullable(),
    createdAt: z.iso.datetime(),
  })
  .openapi("RoleAssignmentDetailDto");
export type RoleAssignmentDetailDto = z.infer<typeof RoleAssignmentDetailDto>;

export const UserSummaryDto = z
  .object({
    id: z.string(),
    email: z.string(),
    displayName: z.string(),
    lastSeenAt: z.iso.datetime().nullable(),
    roles: z.array(RoleAssignmentDetailDto),
  })
  .openapi("UserSummaryDto");
export type UserSummaryDto = z.infer<typeof UserSummaryDto>;

export const ListUsersResponse = z
  .object({ users: z.array(UserSummaryDto) })
  .openapi("ListUsersResponse");
export type ListUsersResponse = z.infer<typeof ListUsersResponse>;

export const GrantRoleRequest = z
  .object({ role: RoleSchema, scope: ScopeInput })
  .strict()
  .openapi("GrantRoleRequest");
export type GrantRoleRequest = z.infer<typeof GrantRoleRequest>;

/** 404: no such user or assignment. 409: `details[].path` names the `ConflictReason`. */
export const peopleRoutes = {
  listUsers: defineRoute({
    method: "get",
    path: "/api/v1/users",
    summary: "Users who have signed in, with their role assignments, sorted by display name",
    permission: "users.list",
    responses: { 200: ListUsersResponse },
  }),
  grantRole: defineRoute({
    method: "post",
    path: "/api/v1/users/{userId}/roles",
    summary: "Grant a role to a user at organisation, site or department scope",
    permission: "roles.assign",
    recentAuth: true,
    request: { params: z.object({ userId: z.uuid() }), body: GrantRoleRequest },
    responses: { 201: RoleAssignmentDetailDto, 404: ErrorResponse, 409: ErrorResponse },
  }),
  revokeRole: defineRoute({
    method: "delete",
    path: "/api/v1/role-assignments/{assignmentId}",
    summary: "Remove a role assignment; the last organisation administrator cannot be removed",
    permission: "roles.assign",
    recentAuth: true,
    request: { params: z.object({ assignmentId: z.uuid() }) },
    responses: { 200: RoleAssignmentDetailDto, 404: ErrorResponse, 409: ErrorResponse },
  }),
};
