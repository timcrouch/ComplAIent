import { z } from "zod";
import "../zod.js";
import { ModuleKeySchema } from "../modules.js";
import { PermissionSchema, RoleSchema } from "../permissions.js";
import { defineRoute } from "../route.js";
import { ConcernRankKeySchema } from "./concern-rewards.js";

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

/** The colour theme chosen in the account menu; "system" follows the device (#2). */
export const ThemeSchema = z.enum(["light", "dark", "system"]).openapi("Theme");
export type Theme = z.infer<typeof ThemeSchema>;

export const MeResponse = z
  .object({
    id: z.string(),
    email: z.string(),
    displayName: z.string(),
    roles: z.array(RoleAssignmentDto),
    permissions: z.array(PermissionSchema),
    viewMode: ViewModeSchema,
    theme: ThemeSchema,
    /** The optional modules switched on, in key order (as on `GET /organisation`). */
    modules: z.array(ModuleKeySchema),
    /** Current recognition rank after at least one useful concern has been validated. */
    concernRank: ConcernRankKeySchema.nullable(),
  })
  .openapi("MeResponse");
export type MeResponse = z.infer<typeof MeResponse>;

/** Either preference, or both; an empty body is refused. */
export const UpdatePreferencesRequest = z
  .object({ viewMode: ViewModeSchema.optional(), theme: ThemeSchema.optional() })
  .strict()
  .refine((body) => body.viewMode !== undefined || body.theme !== undefined, {
    message: "Give a view mode or a theme",
  })
  .openapi("UpdatePreferencesRequest");
export type UpdatePreferencesRequest = z.infer<typeof UpdatePreferencesRequest>;

export const PreferencesResponse = z
  .object({ viewMode: ViewModeSchema, theme: ThemeSchema })
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
    summary: "Save the current user's view mode and/or colour theme",
    permission: "me.update",
    request: { body: UpdatePreferencesRequest },
    responses: { 200: PreferencesResponse },
  }),
};
