import { z } from "zod";
import "../zod.js";
import { ErrorResponse } from "../errors.js";
import { defineRoute } from "../route.js";
import { text, textOrEmpty } from "../text.js";
import { RiskDetailDto } from "./risk-dtos.js";

const riskParams = z.object({ id: z.uuid() });
const expectedVersion = z.number().int().min(1);

export const CloseRiskInput = z
  .object({ expectedVersion, note: text(2000, "multiline") })
  .strict()
  .openapi("CloseRiskInput");
export type CloseRiskInput = z.infer<typeof CloseRiskInput>;

export const ReassessRiskInput = z
  .object({ expectedVersion, reason: text(2000, "multiline") })
  .strict()
  .openapi("ReassessRiskInput");
export type ReassessRiskInput = z.infer<typeof ReassessRiskInput>;

export const ConfirmReviewInput = z
  .object({ expectedVersion, note: textOrEmpty(2000, "multiline") })
  .strict()
  .openapi("ConfirmReviewInput");
export type ConfirmReviewInput = z.infer<typeof ConfirmReviewInput>;

/** 404: not visible to the caller. 409: `details[].path` names the `ConflictReason`. */
export const riskLifecycleRoutes = {
  close: defineRoute({
    method: "post",
    path: "/api/v1/risks/{id}/close",
    summary: "Mark an approved risk as treated; 409 openTreatmentActions while actions are open",
    permission: "risks.review",
    request: { params: riskParams, body: CloseRiskInput },
    responses: { 200: RiskDetailDto, 404: ErrorResponse, 409: ErrorResponse },
  }),
  reassess: defineRoute({
    method: "post",
    path: "/api/v1/risks/{id}/reassess",
    summary: "Reopen an approved or closed risk for reassessment; it becomes proposed",
    permission: "risks.review",
    request: { params: riskParams, body: ReassessRiskInput },
    responses: { 200: RiskDetailDto, 404: ErrorResponse, 409: ErrorResponse },
  }),
  confirmReview: defineRoute({
    method: "post",
    path: "/api/v1/risks/{id}/review-confirmation",
    summary: "Confirm an approved or closed risk is still accurate; the next review moves on",
    permission: "risks.review",
    request: { params: riskParams, body: ConfirmReviewInput },
    responses: { 200: RiskDetailDto, 404: ErrorResponse, 409: ErrorResponse },
  }),
};
