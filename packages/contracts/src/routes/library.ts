import { CONTROL_CATEGORIES, CONTROL_CODE_PATTERN } from "@isms/domain";
import { z } from "zod";
import "../zod.js";
import { ErrorResponse } from "../errors.js";
import { defineRoute } from "../route.js";
import { ControlTestResultSchema } from "./control-operation.js";

export const ControlCategorySchema = z.enum(CONTROL_CATEGORIES).openapi("ControlCategory");

export const FrameworkVersionDto = z
  .object({
    id: z.string(),
    key: z.string(),
    frameworkKey: z.string(),
    name: z.string(),
    versionLabel: z.string(),
    summary: z.string(),
    requirementCount: z.number().int(),
  })
  .openapi("FrameworkVersionDto");
export type FrameworkVersionDto = z.infer<typeof FrameworkVersionDto>;

/** Whether a CISO has confirmed that a control meets a requirement. */
export const MappingReviewDto = z
  .discriminatedUnion("status", [
    z.object({ status: z.literal("unreviewed") }),
    z.object({
      status: z.literal("reviewed"),
      reviewedBy: z.object({ id: z.string(), displayName: z.string() }),
      reviewedAt: z.iso.datetime(),
    }),
  ])
  .openapi("MappingReviewDto");
export type MappingReviewDto = z.infer<typeof MappingReviewDto>;

export const MappingDto = z
  .object({
    id: z.string(),
    frameworkVersionKey: z.string(),
    frameworkName: z.string(),
    versionLabel: z.string(),
    requirementRef: z.string(),
    requirementTitle: z.string(),
    review: MappingReviewDto,
  })
  .openapi("MappingDto");
export type MappingDto = z.infer<typeof MappingDto>;

export const ControlSummaryDto = z
  .object({
    code: z.string(),
    title: z.string(),
    category: ControlCategorySchema,
    /** Framework version keys, sorted. */
    frameworks: z.array(z.string()),
    mappings: z.object({ total: z.number().int(), reviewed: z.number().int() }),
    /** Accepted on at least one risk. */
    inUse: z.boolean(),
    /** The result of the newest test, or null if never tested. */
    latestResult: ControlTestResultSchema.nullable(),
  })
  .openapi("ControlSummaryDto");
export type ControlSummaryDto = z.infer<typeof ControlSummaryDto>;

export const ControlDetailDto = z
  .object({
    code: z.string(),
    title: z.string(),
    description: z.string(),
    guidance: z.array(z.string()),
    category: ControlCategorySchema,
    libraryVersion: z.string(),
    mappings: z.array(MappingDto),
  })
  .openapi("ControlDetailDto");
export type ControlDetailDto = z.infer<typeof ControlDetailDto>;

export const LibraryExportRow = z
  .object({
    controlCode: z.string(),
    controlTitle: z.string(),
    category: ControlCategorySchema,
    frameworkVersionKey: z.string(),
    frameworkName: z.string(),
    requirementRef: z.string(),
    requirementTitle: z.string(),
    reviewStatus: z.enum(["unreviewed", "reviewed"]),
    reviewedBy: z.string().nullable(),
    reviewedAt: z.iso.datetime().nullable(),
  })
  .openapi("LibraryExportRow");
export type LibraryExportRow = z.infer<typeof LibraryExportRow>;

export const ControlListQuery = z
  .object({
    q: z.string().trim().max(200).optional(),
    framework: z
      .string()
      .max(100)
      .regex(/^[a-z0-9][a-z0-9.-]*$/)
      .optional(),
    review: z.enum(["all", "unreviewed", "reviewed"]).default("all"),
    category: ControlCategorySchema.optional(),
    /** "true": only controls accepted on a risk; "false": only the others; absent: all. */
    inUse: z.enum(["true", "false"]).optional(),
  })
  .openapi("ControlListQuery");
export type ControlListQuery = z.infer<typeof ControlListQuery>;

export const ListFrameworksResponse = z
  .object({ frameworks: z.array(FrameworkVersionDto) })
  .openapi("ListFrameworksResponse");
export type ListFrameworksResponse = z.infer<typeof ListFrameworksResponse>;

export const ControlListResponse = z
  .object({ libraryVersion: z.string().nullable(), items: z.array(ControlSummaryDto) })
  .openapi("ControlListResponse");
export type ControlListResponse = z.infer<typeof ControlListResponse>;

export const ExportLibraryResponse = z
  .object({
    libraryVersion: z.string().nullable(),
    generatedAt: z.iso.datetime(),
    rows: z.array(LibraryExportRow),
  })
  .openapi("ExportLibraryResponse");
export type ExportLibraryResponse = z.infer<typeof ExportLibraryResponse>;

export const libraryRoutes = {
  listFrameworks: defineRoute({
    method: "get",
    path: "/api/v1/library/frameworks",
    summary: "Framework versions in the control library, with requirement counts",
    permission: "library.read",
    responses: { 200: ListFrameworksResponse },
  }),
  listControls: defineRoute({
    method: "get",
    path: "/api/v1/library/controls",
    summary: "Search and filter the control library, sorted by code",
    permission: "library.read",
    request: { query: ControlListQuery },
    responses: { 200: ControlListResponse },
  }),
  getControl: defineRoute({
    method: "get",
    path: "/api/v1/library/controls/{code}",
    summary: "One control with its guidance and requirement mappings",
    permission: "library.read",
    request: { params: z.object({ code: z.string().regex(CONTROL_CODE_PATTERN) }) },
    responses: { 200: ControlDetailDto, 404: ErrorResponse },
  }),
  reviewMapping: defineRoute({
    method: "post",
    path: "/api/v1/library/mappings/{mappingId}/review",
    summary:
      "Mark a control-to-requirement mapping as reviewed; repeating it keeps the first review",
    permission: "library.review",
    request: { params: z.object({ mappingId: z.uuid() }) },
    responses: { 200: MappingDto, 404: ErrorResponse },
  }),
  exportLibrary: defineRoute({
    method: "get",
    path: "/api/v1/library/export",
    summary: "Every control-to-requirement mapping with its review status",
    permission: "library.read",
    responses: { 200: ExportLibraryResponse },
  }),
};
