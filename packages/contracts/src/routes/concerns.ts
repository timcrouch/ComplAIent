import { z } from "zod";
import "../zod.js";
import { ErrorResponse } from "../errors.js";
import { defineRoute } from "../route.js";
import { text } from "../text.js";
import { AiReadinessReasonSchema } from "./ai-settings.js";
import { AssetTypeSchema, ReportRiskInput, RiskDetailDto } from "./risks.js";

export const ConversationStatusSchema = z
  .enum(["open", "submitted", "abandoned"])
  .openapi("ConversationStatus");

/** Whether the next AI turn can run now, and why not. */
export const ConcernAiStatusDto = z
  .object({ available: z.boolean(), reason: AiReadinessReasonSchema.nullable() })
  .openapi("ConcernAiStatusDto");
export type ConcernAiStatusDto = z.infer<typeof ConcernAiStatusDto>;

export const ConcernMessageDto = z
  .object({
    seq: z.number().int(),
    role: z.enum(["reporter", "assistant"]),
    /** Empty for an assistant summary turn; its record is in `draft`. */
    text: z.string(),
    chips: z.array(z.string()),
    notSure: z.boolean(),
  })
  .openapi("ConcernMessageDto");
export type ConcernMessageDto = z.infer<typeof ConcernMessageDto>;

/**
 * The AI's drafted record: ReportRiskInput's fields for the reporter to check, plus the AI's
 * estimate, which is read-only (submit takes it from the server-side draft, P3-R5).
 */
export const ConcernDraftDto = z
  .object({
    title: z.string(),
    scenario: z.string(),
    threat: z.string(),
    consequence: z.string(),
    existingSafeguards: z.string(),
    assets: z.array(z.object({ name: z.string(), type: AssetTypeSchema })),
    siteId: z.string().nullable(),
    departmentId: z.string().nullable(),
    toConfirm: z.array(z.string()),
    aiEstimate: z
      .object({ likelihood: z.number().int(), impact: z.number().int(), reasoning: z.string() })
      .nullable(),
  })
  .openapi("ConcernDraftDto");
export type ConcernDraftDto = z.infer<typeof ConcernDraftDto>;

export const ConversationDto = z
  .object({
    id: z.string(),
    status: ConversationStatusSchema,
    messages: z.array(ConcernMessageDto),
    draft: ConcernDraftDto.nullable(),
    questionCount: z.number().int(),
    ai: ConcernAiStatusDto,
  })
  .openapi("ConversationDto");
export type ConversationDto = z.infer<typeof ConversationDto>;

/** A submitted conversation, read-only, for the reporter and transcript readers. */
export const ConcernTranscriptDto = z
  .object({
    id: z.string(),
    status: ConversationStatusSchema,
    messages: z.array(ConcernMessageDto),
  })
  .openapi("ConcernTranscriptDto");
export type ConcernTranscriptDto = z.infer<typeof ConcernTranscriptDto>;

export const StartConcernInput = z
  .object({ text: text(4000, "multiline") })
  .strict()
  .openapi("StartConcernInput");
export type StartConcernInput = z.infer<typeof StartConcernInput>;

export const ConcernReplyInput = z
  .object({ text: text(4000, "multiline"), notSure: z.boolean().default(false) })
  .strict()
  .openapi("ConcernReplyInput");
export type ConcernReplyInput = z.infer<typeof ConcernReplyInput>;

const conversationParams = z.object({ id: z.uuid() });

/**
 * Reporting a concern by conversation. Only the reporter reaches a conversation (404 otherwise).
 * 409: `aiUnavailable.<reason>` when a turn cannot run (the reporter's words are kept); when the
 * first turn of `start` fails after the conversation was stored, a second detail
 * `{ path: "conversationId", message: <id> }` names it so the web can resume or abandon it.
 * `staleVersion` when another reply's turn wrote first; `conversationClosed` when it is no
 * longer open.
 */
export const concernRoutes = {
  aiStatus: defineRoute({
    method: "get",
    path: "/api/v1/concerns/ai-status",
    summary: "Whether a concern can be reported by conversation now, or only with the form",
    permission: "risks.report",
    responses: { 200: ConcernAiStatusDto },
  }),
  start: defineRoute({
    method: "post",
    path: "/api/v1/concerns",
    summary: "Start a conversation with the reporter's first message; the AI asks a question",
    permission: "risks.report",
    request: { body: StartConcernInput },
    responses: { 201: ConversationDto, 409: ErrorResponse },
  }),
  reply: defineRoute({
    method: "post",
    path: "/api/v1/concerns/{id}/messages",
    summary: "Answer the AI's question (or say not sure); the AI asks again or summarises",
    permission: "risks.report",
    request: { params: conversationParams, body: ConcernReplyInput },
    responses: { 200: ConversationDto, 404: ErrorResponse, 409: ErrorResponse },
  }),
  get: defineRoute({
    method: "get",
    path: "/api/v1/concerns/{id}",
    summary: "The caller's own conversation with its messages and draft",
    permission: "risks.report",
    request: { params: conversationParams },
    responses: { 200: ConversationDto, 404: ErrorResponse },
  }),
  submit: defineRoute({
    method: "post",
    path: "/api/v1/concerns/{id}/submit",
    summary: "Report the checked draft as a proposed, AI-assisted risk",
    permission: "risks.report",
    request: { params: conversationParams, body: ReportRiskInput },
    responses: { 201: RiskDetailDto, 404: ErrorResponse, 409: ErrorResponse },
  }),
  abandon: defineRoute({
    method: "post",
    path: "/api/v1/concerns/{id}/abandon",
    summary: "Close an open conversation without reporting",
    permission: "risks.report",
    request: { params: conversationParams },
    responses: { 200: ConversationDto, 404: ErrorResponse, 409: ErrorResponse },
  }),
  transcript: defineRoute({
    method: "get",
    path: "/api/v1/risks/{id}/conversation",
    summary:
      "The conversation a risk was reported through: its reporter, administrators, or transcript readers who see the risk",
    permission: "me.read",
    request: { params: conversationParams },
    responses: { 200: ConcernTranscriptDto, 404: ErrorResponse },
  }),
};
