import { z } from "zod";
import "../zod.js";
import { PermissionSchema, RoleSchema } from "../permissions.js";
import { defineRoute } from "../route.js";

export const RoleAssignmentDto = z
  .object({
    role: RoleSchema,
    scope: z.object({
      type: z.enum(["organisation", "site", "department"]),
      id: z.string().nullable(),
    }),
  })
  .openapi("RoleAssignmentDto");
export type RoleAssignmentDto = z.infer<typeof RoleAssignmentDto>;

export const ViewModeSchema = z.enum(["guided", "professional", "executive"]).openapi("ViewMode");
export type ViewMode = z.infer<typeof ViewModeSchema>;

export const MeResponse = z
  .object({
    id: z.string(),
    email: z.string(),
    displayName: z.string(),
    roles: z.array(RoleAssignmentDto),
    permissions: z.array(PermissionSchema),
    viewMode: ViewModeSchema,
  })
  .openapi("MeResponse");
export type MeResponse = z.infer<typeof MeResponse>;

export const UpdatePreferencesRequest = z
  .object({ viewMode: ViewModeSchema })
  .strict()
  .openapi("UpdatePreferencesRequest");
export type UpdatePreferencesRequest = z.infer<typeof UpdatePreferencesRequest>;

export const PreferencesResponse = z
  .object({ viewMode: ViewModeSchema })
  .openapi("PreferencesResponse");
export type PreferencesResponse = z.infer<typeof PreferencesResponse>;

export const identityRoutes = {
  me: defineRoute({
    method: "get",
    path: "/api/v1/me",
    summary: "Current user profile, roles and permissions",
    permission: "me.read",
    responses: { 200: MeResponse },
  }),
  updatePreferences: defineRoute({
    method: "patch",
    path: "/api/v1/me/preferences",
    summary: "Save the current user's view mode",
    permission: "me.update",
    request: { body: UpdatePreferencesRequest },
    responses: { 200: PreferencesResponse },
  }),
};
