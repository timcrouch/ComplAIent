import { z } from "zod";
import "./zod.js";

export const RoleSchema = z
  .enum([
    "administrator",
    "ciso",
    "risk_owner",
    "risk_approver",
    "contributor",
    "viewer",
    "auditor",
  ])
  .openapi("Role");
export type Role = z.infer<typeof RoleSchema>;

export const PermissionSchema = z
  .enum([
    "me.read",
    "me.update",
    "users.list",
    "roles.assign",
    "audit.read",
    "settings.ai.manage",
    "library.read",
    "library.review",
    "organisation.read",
    "organisation.manage",
    "risks.report",
    "risks.read",
    "risks.review",
    "risks.approve",
    "controls.test",
    "ai.transcripts.read",
    "reports.read",
    "reports.narrative",
    "soa.manage",
  ])
  .openapi("Permission");
export type Permission = z.infer<typeof PermissionSchema>;
