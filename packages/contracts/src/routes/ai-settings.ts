import { z } from "zod";
import "../zod.js";
import { ErrorResponse } from "../errors.js";
import { defineRoute } from "../route.js";
import { PersonRef } from "./risks.js";

/** Why AI calls cannot be made right now (the gateway's readiness reasons). */
export const AiReadinessReasonSchema = z
  .enum(["disabled", "noKey", "privacyOff", "noModel", "secretsKeyMissing", "keyUnreadable"])
  .openapi("AiReadinessReason");
export type AiReadinessReason = z.infer<typeof AiReadinessReasonSchema>;

const ModelId = z.string().min(1).max(200);

export const AiModelsDto = z
  .object({
    conversation: ModelId.nullable(),
    controls: ModelId.nullable(),
    frameworks: ModelId.nullable(),
  })
  .openapi("AiModelsDto");
export type AiModelsDto = z.infer<typeof AiModelsDto>;

/** Write-only key: only whether it is set, its last 4 characters, who set it and when. */
export const AiKeyStatusDto = z
  .discriminatedUnion("set", [
    z.object({ set: z.literal(false) }),
    z.object({
      set: z.literal(true),
      last4: z.string(),
      setBy: PersonRef,
      setAt: z.iso.datetime(),
      /** False when AI_SECRETS_KEY is missing or changed since the key was saved. */
      readable: z.boolean(),
    }),
  ])
  .openapi("AiKeyStatusDto");
export type AiKeyStatusDto = z.infer<typeof AiKeyStatusDto>;

export const AiSettingsDto = z
  .object({
    enabled: z.boolean(),
    euOnly: z.boolean(),
    zeroRetention: z.boolean(),
    key: AiKeyStatusDto,
    models: AiModelsDto,
    readiness: z.object({ ready: z.boolean(), reason: AiReadinessReasonSchema.nullable() }),
    secretsKeyConfigured: z.boolean(),
    provider: z.enum(["openrouter", "mock"]),
    /** True only when the server runs with AI_ALLOW_NON_EU_ROUTING (development): EU-only may be off. */
    nonEuRoutingAllowed: z.boolean(),
  })
  .openapi("AiSettingsDto");
export type AiSettingsDto = z.infer<typeof AiSettingsDto>;

/** Printable ASCII only: no whitespace or control characters inside the key. */
export const SetAiKeyInput = z
  .object({
    key: z
      .string()
      .trim()
      .min(20)
      .max(200)
      .regex(/^[\x21-\x7e]+$/),
  })
  .strict()
  .openapi("SetAiKeyInput");
export type SetAiKeyInput = z.infer<typeof SetAiKeyInput>;

const ModelChoice = ModelId.nullable().optional();

export const AiSettingsUpdateInput = z
  .object({
    enabled: z.boolean().optional(),
    euOnly: z.boolean().optional(),
    zeroRetention: z.boolean().optional(),
    models: z
      .object({ conversation: ModelChoice, controls: ModelChoice, frameworks: ModelChoice })
      .strict()
      .refine((m) => Object.values(m).some((v) => v !== undefined), {
        message: "Choose at least one model",
      })
      .optional(),
  })
  .strict()
  .refine((u) => Object.values(u).some((v) => v !== undefined), {
    message: "Change at least one setting",
  })
  .openapi("AiSettingsUpdateInput");
export type AiSettingsUpdateInput = z.infer<typeof AiSettingsUpdateInput>;

export const AiModelListResponse = z
  .object({ models: z.array(z.object({ id: z.string(), name: z.string() })) })
  .openapi("AiModelListResponse");
export type AiModelListResponse = z.infer<typeof AiModelListResponse>;

export const AiTestFailureReasonSchema = z
  .enum([
    "noKey",
    "privacyOff",
    "secretsKeyMissing",
    "keyUnreadable",
    "auth",
    "regionNotAllowed",
    "noEndpoint",
    "rateLimited",
    "timeout",
    "unavailable",
  ])
  .openapi("AiTestFailureReason");
export type AiTestFailureReason = z.infer<typeof AiTestFailureReasonSchema>;

export const AiTestConnectionResponse = z
  .discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), model: z.string() }),
    z.object({ ok: z.literal(false), reason: AiTestFailureReasonSchema }),
  ])
  .openapi("AiTestConnectionResponse");
export type AiTestConnectionResponse = z.infer<typeof AiTestConnectionResponse>;

/**
 * Administrator-only AI settings (spec §11.1). Every write needs a recent sign-in. 409 reasons:
 * `secretsKeyMissing`, `keyUnreadable`, or `aiUnavailable.<noKey|privacyOff|provider error kind>`.
 */
export const aiSettingsRoutes = {
  get: defineRoute({
    method: "get",
    path: "/api/v1/settings/ai",
    summary: "AI settings: switches, models, key status (never the key) and readiness",
    permission: "settings.ai.manage",
    responses: { 200: AiSettingsDto },
  }),
  setKey: defineRoute({
    method: "put",
    path: "/api/v1/settings/ai/key",
    summary: "Save or replace the provider key; it is sealed and can never be read back",
    permission: "settings.ai.manage",
    recentAuth: true,
    request: { body: SetAiKeyInput },
    responses: { 200: AiSettingsDto, 409: ErrorResponse },
  }),
  removeKey: defineRoute({
    method: "delete",
    path: "/api/v1/settings/ai/key",
    summary: "Remove the provider key",
    permission: "settings.ai.manage",
    recentAuth: true,
    responses: { 200: AiSettingsDto },
  }),
  update: defineRoute({
    method: "patch",
    path: "/api/v1/settings/ai",
    summary: "Change the master switch, privacy settings or models; models must be offered",
    permission: "settings.ai.manage",
    recentAuth: true,
    request: { body: AiSettingsUpdateInput },
    responses: { 200: AiSettingsDto, 409: ErrorResponse },
  }),
  listModels: defineRoute({
    method: "get",
    path: "/api/v1/settings/ai/models",
    summary: "Models the provider offers under EU routing and zero retention",
    permission: "settings.ai.manage",
    responses: { 200: AiModelListResponse, 409: ErrorResponse },
  }),
  test: defineRoute({
    method: "post",
    path: "/api/v1/settings/ai/test",
    summary: "Send a harmless test request and report the outcome",
    permission: "settings.ai.manage",
    recentAuth: true,
    responses: { 200: AiTestConnectionResponse },
  }),
};
