import { z } from "zod";
import { defineRoute } from "../route.js";
import { text } from "../text.js";

export const ConcernLegitimacySchema = z.enum([
  "confirmed",
  "plausible",
  "confirmed_duplicate",
  "not_confirmed",
  "out_of_scope",
  "abusive",
]);
export const ConcernSeveritySchema = z.enum([
  "informational",
  "minor",
  "moderate",
  "major",
  "critical",
]);
export const ConcernEvaluationStatusSchema = z.enum([
  "pending",
  "provisional",
  "final",
  "overridden",
  "suspended",
]);
export const ConcernBadgeKeySchema = z.enum([
  "first_signal",
  "sharp_eye",
  "early_warning",
  "high_impact",
  "consistent_guardian",
  "corroborator",
]);
export const ConcernRankKeySchema = z.enum([
  "recruit",
  "defender",
  "protector",
  "guardian",
  "security_vanguard",
]);

export const ConcernPointsDto = z.object({
  legitimacy: z.number().int(),
  severity: z.number().int(),
  position: z.number().int(),
  total: z.number().int(),
});

export const ConcernEvaluationDto = z
  .object({
    id: z.uuid(),
    riskId: z.uuid(),
    riskReference: z.string(),
    status: ConcernEvaluationStatusSchema,
    source: z.enum(["ai", "ciso"]).nullable(),
    legitimacy: ConcernLegitimacySchema.nullable(),
    severity: ConcernSeveritySchema.nullable(),
    confidence: z.number().min(0).max(1).nullable(),
    duplicatePosition: z.number().int().positive().nullable(),
    points: ConcernPointsDto,
    feedback: z.string().nullable(),
    requiresReview: z.boolean(),
    evaluatedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  })
  .openapi("ConcernEvaluationDto");
export type ConcernEvaluationDto = z.infer<typeof ConcernEvaluationDto>;

export const ConcernBadgeDto = z.object({
  key: ConcernBadgeKeySchema,
  title: z.string(),
  description: z.string(),
  image: z.string(),
  repeatable: z.boolean(),
  count: z.number().int().positive(),
  firstAwardedAt: z.iso.datetime(),
  lastAwardedAt: z.iso.datetime(),
});

export const SecurityContributionDto = z
  .object({
    enabled: z.boolean(),
    points: z.object({ total: z.number().int().nonnegative(), provisional: z.number().int() }),
    rank: z.object({
      key: ConcernRankKeySchema,
      label: z.string(),
      minimumPoints: z.number().int(),
      next: z
        .object({ key: ConcernRankKeySchema, label: z.string(), minimumPoints: z.number().int() })
        .nullable(),
    }),
    badges: z.array(ConcernBadgeDto),
    recent: z.array(ConcernEvaluationDto),
  })
  .openapi("SecurityContributionDto");
export type SecurityContributionDto = z.infer<typeof SecurityContributionDto>;

export const ConcernEvaluationQueueItemDto = z.object({
  evaluation: ConcernEvaluationDto,
  title: z.string(),
  reporter: z.object({ id: z.uuid(), displayName: z.string() }),
  rationale: z.string().nullable(),
  uncertainty: z.string().nullable(),
  failureReason: z.string().nullable(),
});
export const ConcernEvaluationQueueDto = z.object({
  items: z.array(ConcernEvaluationQueueItemDto),
});
export type ConcernEvaluationQueueDto = z.infer<typeof ConcernEvaluationQueueDto>;

export const JudgeConcernInput = z
  .object({
    legitimacy: ConcernLegitimacySchema,
    severity: ConcernSeveritySchema,
    duplicateRiskId: z.uuid().nullable(),
    feedback: text(500, "multiline"),
    rationale: text(1000, "multiline"),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.legitimacy === "confirmed_duplicate") !== (value.duplicateRiskId !== null)) {
      ctx.addIssue({ code: "custom", path: ["duplicateRiskId"], message: "Duplicate required" });
    }
  })
  .openapi("JudgeConcernInput");
export type JudgeConcernInput = z.infer<typeof JudgeConcernInput>;

const riskParam = z.object({ id: z.uuid() });

export const concernRewardRoutes = {
  contribution: defineRoute({
    method: "get",
    path: "/api/v1/me/security-contribution",
    summary: "The signed-in reporter's private points, rank, badges and recent evaluations",
    permission: "me.read",
    responses: { 200: SecurityContributionDto },
  }),
  queue: defineRoute({
    method: "get",
    path: "/api/v1/concern-evaluations/queue",
    summary: "Pending and escalated concern evaluations for CISO judgment",
    permission: "concerns.judge",
    responses: { 200: ConcernEvaluationQueueDto },
  }),
  get: defineRoute({
    method: "get",
    path: "/api/v1/risks/{id}/concern-evaluation",
    summary: "The reporter's or CISO's current reward evaluation for one concern",
    permission: "me.read",
    request: { params: riskParam },
    responses: { 200: ConcernEvaluationDto },
  }),
  judge: defineRoute({
    method: "post",
    path: "/api/v1/risks/{id}/concern-evaluation",
    summary: "Finalize or override a concern evaluation as the CISO",
    permission: "concerns.judge",
    recentAuth: true,
    request: { params: riskParam, body: JudgeConcernInput },
    responses: { 200: ConcernEvaluationDto },
  }),
} as const;
