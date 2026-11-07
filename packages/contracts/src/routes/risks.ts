import { CONTROL_CODE_PATTERN } from "@isms/domain";
import { z } from "zod";
import "../zod.js";
import { ErrorResponse } from "../errors.js";
import { defineRoute } from "../route.js";
import { text, textOrEmpty } from "../text.js";
import {
  AssetTypeSchema,
  RiskDetailDto,
  RiskStateSchema,
  RiskSummaryDto,
  TreatmentSchema,
} from "./risk-dtos.js";
import { MapBasisSchema } from "./risk-insights.js";

export * from "./risk-dtos.js";

export const AssetInput = z
  .object({ name: text(120, "name"), type: AssetTypeSchema })
  .strict()
  .openapi("AssetInput");
export type AssetInput = z.infer<typeof AssetInput>;

const level = z.number().int().min(1).max(5);
const reportFields = {
  title: text(120),
  scenario: text(2000, "multiline"),
  threat: text(1000, "multiline"),
  consequence: text(1000, "multiline"),
  /** May be empty: "nothing protects against this yet". */
  existingSafeguards: textOrEmpty(1000, "multiline"),
  assets: z.array(AssetInput).max(10),
  siteId: z.uuid().nullable(),
  departmentId: z.uuid().nullable(),
  toConfirm: z.array(text(300)).max(10),
};

export const ReportRiskInput = z.object(reportFields).strict().openapi("ReportRiskInput");
export type ReportRiskInput = z.infer<typeof ReportRiskInput>;

export const RiskChanges = z
  .object({
    title: reportFields.title,
    scenario: reportFields.scenario,
    threat: reportFields.threat,
    consequence: reportFields.consequence,
    existingSafeguards: reportFields.existingSafeguards,
    toConfirm: reportFields.toConfirm,
    assets: reportFields.assets,
    likelihood: level.nullable(),
    impact: level.nullable(),
    residualLikelihood: level.nullable(),
    residualImpact: level.nullable(),
    treatment: TreatmentSchema.nullable(),
    /** May be emptied. */
    treatmentNote: textOrEmpty(2000, "multiline"),
    ownerId: z.uuid().nullable(),
    siteId: reportFields.siteId,
    departmentId: reportFields.departmentId,
  })
  .partial()
  .strict()
  .refine((c) => Object.keys(c).length > 0, {
    message: "Change at least one field",
  })
  .openapi("RiskChanges");
export type RiskChanges = z.infer<typeof RiskChanges>;

export const RiskEditInput = z
  .object({ expectedVersion: z.number().int().min(1), changes: RiskChanges })
  .strict()
  .openapi("RiskEditInput");
export type RiskEditInput = z.infer<typeof RiskEditInput>;

export const RiskListFilterSchema = z
  .enum([
    "all",
    "toReview",
    "awaitingMyApproval",
    "aboveAppetite",
    "evidenceMissing",
    "reviewDue",
    "reportedByMe",
    "ownedByMe",
    "noExpectedScore",
  ])
  .openapi("RiskListFilter");
export type RiskListFilter = z.infer<typeof RiskListFilterSchema>;

export const RiskListQuery = z
  .object({
    filter: RiskListFilterSchema.default("all"),
    /** Opaque; the `nextCursor` of the previous page. */
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    /** A map cell: both of likelihood and impact, or neither. */
    likelihood: z.coerce.number().int().min(1).max(5).optional(),
    impact: z.coerce.number().int().min(1).max(5).optional(),
    /** Which assessment places a risk in the cell. */
    basis: MapBasisSchema.default("inherent"),
    /**
     * With a cell, and for the aboveAppetite, evidenceMissing and noExpectedScore filters: closed risks are left
     * out unless "true", as on the map (P6-R3, P6-R8).
     */
    includeClosed: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
  })
  .superRefine((q, ctx) => {
    if ((q.likelihood === undefined) !== (q.impact === undefined))
      ctx.addIssue({
        code: "custom",
        path: ["likelihood"],
        message: "likelihood and impact must be given together",
      });
  })
  .openapi("RiskListQuery");
export type RiskListQuery = z.infer<typeof RiskListQuery>;

export const RiskListResponse = z
  .object({ items: z.array(RiskSummaryDto), nextCursor: z.string().nullable() })
  .openapi("RiskListResponse");
export type RiskListResponse = z.infer<typeof RiskListResponse>;

export const MyConcernsResponse = z
  .object({
    items: z.array(
      z.object({
        id: z.string(),
        reference: z.string(),
        title: z.string(),
        state: RiskStateSchema,
        updatedAt: z.iso.datetime(),
      }),
    ),
  })
  .openapi("MyConcernsResponse");
export type MyConcernsResponse = z.infer<typeof MyConcernsResponse>;

const riskParams = z.object({ id: z.uuid() });
const riskControlParams = z.object({ id: z.uuid(), riskControlId: z.uuid() });

const expectedVersion = z.number().int().min(1);

export const RequestControlSuggestionsInput = z
  .object({ expectedVersion })
  .strict()
  .openapi("RequestControlSuggestionsInput");
export type RequestControlSuggestionsInput = z.infer<typeof RequestControlSuggestionsInput>;

export const DecideControlInput = z
  .object({
    expectedVersion,
    decision: z.enum(["accept", "reject"]),
    reason: text(300).optional(),
  })
  .strict()
  .openapi("DecideControlInput");
export type DecideControlInput = z.infer<typeof DecideControlInput>;

export const AddControlInput = z
  .object({
    expectedVersion,
    controlCode: z.string().regex(CONTROL_CODE_PATTERN),
    reason: text(300).optional(),
  })
  .strict()
  .openapi("AddControlInput");
export type AddControlInput = z.infer<typeof AddControlInput>;

export const RemoveControlInput = z
  .object({ expectedVersion })
  .strict()
  .openapi("RemoveControlInput");
export type RemoveControlInput = z.infer<typeof RemoveControlInput>;

export const SubmitRiskInput = z.object({ expectedVersion }).strict().openapi("SubmitRiskInput");
export type SubmitRiskInput = z.infer<typeof SubmitRiskInput>;

export const ApproveRiskInput = z
  .object({ expectedVersion, comment: text(2000, "multiline").optional() })
  .strict()
  .openapi("ApproveRiskInput");
export type ApproveRiskInput = z.infer<typeof ApproveRiskInput>;

export const ReturnRiskInput = z
  .object({ expectedVersion, comment: text(2000, "multiline") })
  .strict()
  .openapi("ReturnRiskInput");
export type ReturnRiskInput = z.infer<typeof ReturnRiskInput>;

/** 404: not visible to the caller. 409: `details[].path` names the `ConflictReason`. */
export const riskRoutes = {
  report: defineRoute({
    method: "post",
    path: "/api/v1/risks",
    summary: "Report a risk with the form; it starts proposed, for review",
    permission: "risks.report",
    request: { body: ReportRiskInput },
    responses: { 201: RiskDetailDto },
  }),
  list: defineRoute({
    method: "get",
    path: "/api/v1/risks",
    summary: "Risks the caller may see, newest change first, filtered and paged",
    permission: "risks.read",
    request: { query: RiskListQuery },
    responses: { 200: RiskListResponse },
  }),
  get: defineRoute({
    method: "get",
    path: "/api/v1/risks/{id}",
    summary: "One risk with its assessment, controls, evidence and history",
    permission: "risks.read",
    request: { params: riskParams },
    responses: { 200: RiskDetailDto, 404: ErrorResponse },
  }),
  update: defineRoute({
    method: "patch",
    path: "/api/v1/risks/{id}",
    summary: "Edit a proposed or returned risk; expectedVersion must be the current version",
    permission: "risks.review",
    request: { params: riskParams, body: RiskEditInput },
    responses: { 200: RiskDetailDto, 404: ErrorResponse, 409: ErrorResponse },
  }),
  requestSuggestions: defineRoute({
    method: "post",
    path: "/api/v1/risks/{id}/control-suggestions",
    summary: "Ask the AI to suggest controls; 409 aiUnavailable.<reason> when it is not ready",
    permission: "risks.review",
    request: { params: riskParams, body: RequestControlSuggestionsInput },
    responses: { 202: RiskDetailDto, 404: ErrorResponse, 409: ErrorResponse },
  }),
  decideControl: defineRoute({
    method: "post",
    path: "/api/v1/risks/{id}/controls/{riskControlId}/decision",
    summary: "Accept or reject a suggested control",
    permission: "risks.review",
    request: { params: riskControlParams, body: DecideControlInput },
    responses: { 200: RiskDetailDto, 404: ErrorResponse, 409: ErrorResponse },
  }),
  addControl: defineRoute({
    method: "post",
    path: "/api/v1/risks/{id}/controls",
    summary: "Add a library control by code; it is accepted at once",
    permission: "risks.review",
    request: { params: riskParams, body: AddControlInput },
    responses: { 201: RiskDetailDto, 404: ErrorResponse, 409: ErrorResponse },
  }),
  removeControl: defineRoute({
    method: "delete",
    path: "/api/v1/risks/{id}/controls/{riskControlId}",
    summary: "Remove an accepted control that has no evidence",
    permission: "risks.review",
    request: { params: riskControlParams, body: RemoveControlInput },
    responses: { 200: RiskDetailDto, 404: ErrorResponse, 409: ErrorResponse },
  }),
  submit: defineRoute({
    method: "post",
    path: "/api/v1/risks/{id}/submit",
    summary:
      "Submit a complete risk for approval; 409 submitBlocked.<blocker> names what is missing",
    permission: "risks.review",
    request: { params: riskParams, body: SubmitRiskInput },
    responses: { 200: RiskDetailDto, 404: ErrorResponse, 409: ErrorResponse },
  }),
  approve: defineRoute({
    method: "post",
    path: "/api/v1/risks/{id}/approve",
    summary:
      "Approve the submitted version; 409 approvalRefused.<reason> under separation of duties",
    permission: "risks.read",
    request: { params: riskParams, body: ApproveRiskInput },
    responses: { 200: RiskDetailDto, 404: ErrorResponse, 409: ErrorResponse },
  }),
  return: defineRoute({
    method: "post",
    path: "/api/v1/risks/{id}/return",
    summary: "Return the submitted risk with a comment; it becomes editable again",
    permission: "risks.read",
    request: { params: riskParams, body: ReturnRiskInput },
    responses: { 200: RiskDetailDto, 404: ErrorResponse, 409: ErrorResponse },
  }),
  myConcerns: defineRoute({
    method: "get",
    path: "/api/v1/me/concerns",
    summary: "The risks the caller reported, newest first, at most 50",
    permission: "risks.report",
    responses: { 200: MyConcernsResponse },
  }),
};
