import { EVIDENCE_TYPES } from "@isms/domain";
import { z } from "zod";
import "../zod.js";
import { ErrorResponse } from "../errors.js";
import { defineRoute } from "../route.js";
import { text } from "../text.js";
import { TaskStatusSchema } from "./risk-dtos.js";
import { EvidenceClassificationSchema, EvidenceDto } from "./risks.js";

/** The nine allowed types of P3-R12; the API also checks extension and magic bytes. */
export const EvidenceMimeTypeSchema = z
  .enum(Object.keys(EVIDENCE_TYPES) as [string, ...string[]])
  .openapi("EvidenceMimeType");

const fileQuery = {
  /** As the uploader named it; the API keeps only a cleaned base name. */
  fileName: text(255),
  mimeType: EvidenceMimeTypeSchema,
  classification: EvidenceClassificationSchema.default("internal"),
};

export const EvidenceUploadQuery = z
  .object({
    ...fileQuery,
    /** Defaults to the upload time. */
    collectedAt: z.iso.date().optional(),
    /** Comma-separated ids of 1-10 controls accepted on the risk. */
    controlIds: z
      .string()
      .max(400)
      .transform((value) => value.split(",").map((id) => id.trim()))
      .pipe(z.array(z.uuid()).min(1).max(10))
      .openapi({ type: "string", description: "Comma-separated control ids (1-10)" }),
  })
  .openapi("EvidenceUploadQuery");
export type EvidenceUploadQuery = z.infer<typeof EvidenceUploadQuery>;

export const TaskUploadQuery = z.object(fileQuery).openapi("TaskUploadQuery");
export type TaskUploadQuery = z.infer<typeof TaskUploadQuery>;

export const EvidenceRequestInput = z
  .object({
    assigneeId: z.uuid(),
    /** A control accepted on the risk. */
    controlId: z.uuid(),
    title: text(120),
    description: text(2000, "multiline"),
    dueDate: z.iso.date().nullable(),
  })
  .strict()
  .openapi("EvidenceRequestInput");
export type EvidenceRequestInput = z.infer<typeof EvidenceRequestInput>;

export const MyTaskDto = z
  .object({
    id: z.string(),
    kind: z.enum(["evidence_request", "treatment_action", "periodic_review"]),
    title: z.string(),
    description: z.string(),
    dueDate: z.iso.date().nullable(),
    status: TaskStatusSchema,
    /** Open and past its due date. */
    overdue: z.boolean(),
    /** Evidence requests name a control; other kinds may. */
    control: z.object({ code: z.string(), title: z.string() }).nullable(),
    /** R-0001; the assignee sees the risk record only when riskId is set. */
    riskReference: z.string(),
    /** The risk's title for treatment actions and periodic reviews; null for evidence requests. */
    riskTitle: z.string().nullable(),
    /** The risk's id, only when the caller may see the risk; null otherwise. */
    riskId: z.string().nullable(),
    /** The note left when it was done; "" when none (a review completed by approval). */
    completionNote: z.string(),
  })
  .openapi("MyTaskDto");
export type MyTaskDto = z.infer<typeof MyTaskDto>;

export const MyTasksResponse = z.object({ items: z.array(MyTaskDto) }).openapi("MyTasksResponse");
export type MyTasksResponse = z.infer<typeof MyTasksResponse>;

const idParams = z.object({ id: z.uuid() });
const fileContent = z.string().openapi({ type: "string", format: "binary" });

export const evidenceRoutes = {
  upload: defineRoute({
    method: "post",
    path: "/api/v1/risks/{id}/evidence",
    summary:
      "Attach a file to accepted controls of a risk, in any state; the body is the file (octet-stream)",
    permission: "risks.review",
    upload: { maxBytesConfig: "EVIDENCE_MAX_BYTES" },
    request: { params: idParams, query: EvidenceUploadQuery },
    responses: { 201: EvidenceDto, 404: ErrorResponse, 409: ErrorResponse },
  }),
  download: defineRoute({
    method: "get",
    path: "/api/v1/evidence/{id}/content",
    summary:
      "Download a file, always as an attachment: for viewers of its risk, or the assignee of the task it completed",
    permission: "me.read",
    download: true,
    request: { params: idParams },
    responses: { 200: fileContent, 404: ErrorResponse },
  }),
  requestEvidence: defineRoute({
    method: "post",
    path: "/api/v1/risks/{id}/evidence-requests",
    summary: "Ask a person for evidence of an accepted control; creates a task for them",
    permission: "risks.review",
    request: { params: idParams, body: EvidenceRequestInput },
    responses: { 201: MyTaskDto, 404: ErrorResponse, 409: ErrorResponse },
  }),
  myTasks: defineRoute({
    method: "get",
    path: "/api/v1/me/tasks",
    summary: "The caller's tasks: open ones first, then those completed in the last 30 days",
    permission: "me.read",
    responses: { 200: MyTasksResponse },
  }),
  uploadForTask: defineRoute({
    method: "post",
    path: "/api/v1/tasks/{id}/evidence",
    summary:
      "The assignee uploads the requested file, which completes the task; the body is the file (octet-stream)",
    permission: "me.read",
    upload: { maxBytesConfig: "EVIDENCE_MAX_BYTES" },
    request: { params: idParams, query: TaskUploadQuery },
    responses: { 201: EvidenceDto, 404: ErrorResponse, 409: ErrorResponse },
  }),
};
