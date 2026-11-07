import { z } from "zod";
import "../zod.js";
import { defineRoute } from "../route.js";
import { RiskMapResponse } from "./risk-insights.js";
import { RiskStateSchema } from "./risks.js";

/** The home statements, in display order. */
export const WorkspaceStatementKeySchema = z
  .enum([
    "approvalsWaiting",
    "toReview",
    "aboveAppetite",
    "evidenceMissing",
    "tasksOpen",
    "actionsOverdue",
    "reviewsDue",
    "concernsUpdated",
  ])
  .openapi("WorkspaceStatementKey");
export type WorkspaceStatementKey = z.infer<typeof WorkspaceStatementKeySchema>;

/** One "you have N …" statement; only sent when the count is above zero. */
export const WorkspaceStatementDto = z
  .object({
    key: WorkspaceStatementKeySchema,
    count: z.number().int().min(1),
    /** The web path that lists exactly what was counted. */
    href: z.string(),
  })
  .openapi("WorkspaceStatementDto");
export type WorkspaceStatementDto = z.infer<typeof WorkspaceStatementDto>;

const count = z.number().int().min(0);

/** Counts over the viewer's visible risks (and the tasks on them). */
export const WorkspaceDimensionsDto = z
  .object({
    risks: z.object({
      total: count,
      aboveAppetite: count,
      proposed: count,
      inReview: count,
      approved: count,
      returned: count,
      closed: count,
    }),
    /** `testedWithinInterval`: accepted controls whose latest test is not yet due. */
    controls: z.object({ accepted: count, withEvidence: count, testedWithinInterval: count }),
    /** `missing`: visible risks with an accepted control lacking evidence (P3-R13). */
    evidence: z.object({ items: count, missing: count }),
    tasks: z.object({ open: count, overdue: count }),
  })
  .openapi("WorkspaceDimensionsDto");
export type WorkspaceDimensionsDto = z.infer<typeof WorkspaceDimensionsDto>;

export const WorkspaceConcernDto = z
  .object({
    id: z.string(),
    reference: z.string(),
    title: z.string(),
    state: RiskStateSchema,
    updatedAt: z.iso.datetime(),
  })
  .openapi("WorkspaceConcernDto");
export type WorkspaceConcernDto = z.infer<typeof WorkspaceConcernDto>;

export const WorkspaceTaskDto = z
  .object({
    id: z.string(),
    kind: z.enum(["evidence_request", "treatment_action", "periodic_review"]),
    /** As stored; a periodic review's label is built by the client from the risk fields. */
    title: z.string(),
    riskReference: z.string(),
    /** As in MyTaskDto: null for evidence requests. */
    riskTitle: z.string().nullable(),
    /** As in MyTaskDto: only when the viewer may see the risk. */
    riskId: z.string().nullable(),
    dueDate: z.iso.date().nullable(),
    overdue: z.boolean(),
  })
  .openapi("WorkspaceTaskDto");
export type WorkspaceTaskDto = z.infer<typeof WorkspaceTaskDto>;

/** The inherent risk map and 12 weeks of reports, approvals and closings, over the viewer's visible risks. */
export const RiskPictureDto = z
  .object({
    map: RiskMapResponse,
    movement: z
      .array(z.object({ weekStart: z.iso.date(), reported: count, approved: count, closed: count }))
      .length(12),
  })
  .openapi("RiskPictureDto");
export type RiskPictureDto = z.infer<typeof RiskPictureDto>;

export const WorkspaceResponse = z
  .object({
    statements: z.array(WorkspaceStatementDto),
    /** Null unless the viewer holds risks.read at some scope. */
    dimensions: WorkspaceDimensionsDto.nullable(),
    /** Null unless the viewer holds risks.read at some scope. */
    riskPicture: RiskPictureDto.nullable(),
    /** The viewer's own reports, newest first, at most 5. */
    myConcerns: z.array(WorkspaceConcernDto).max(5),
    /** The viewer's open tasks, soonest due first, at most 5. */
    myTasks: z.array(WorkspaceTaskDto).max(5),
  })
  .openapi("WorkspaceResponse");
export type WorkspaceResponse = z.infer<typeof WorkspaceResponse>;

export const workspaceRoutes = {
  get: defineRoute({
    method: "get",
    path: "/api/v1/workspace",
    summary: "The home workspace: what needs the viewer's attention, and counts over what they see",
    permission: "me.read",
    responses: { 200: WorkspaceResponse },
  }),
};
