import { isAboveAppetite, riskScore } from "./risk-scale.js";
import type { Treatment } from "./risk.js";

export type ApprovalRule = "reviewerMayApprove" | "independentApprover";

export function approvalRule(r: {
  likelihood: number;
  impact: number;
  treatment: Treatment;
  appetiteThreshold: number;
}): ApprovalRule {
  const above = isAboveAppetite(riskScore(r.likelihood, r.impact), r.appetiteThreshold);
  return above || r.treatment === "accept" ? "independentApprover" : "reviewerMayApprove";
}

export type ApprovalRefusal = "reporter" | "reviewerNeedsIndependent" | "notApprover";

/**
 * Separation of duties (spec §8.3, P3-R4). The reporter never approves. The reviewer (who
 * submitted it) approves only under `reviewerMayApprove`, for which holding `risks.review` at
 * the risk's scope is enough. Anyone else needs `risks.approve` at the risk's scope.
 */
export function approvalRefusal(a: {
  actorId: string;
  reporterId: string;
  reviewerId: string;
  actorHoldsApprove: boolean;
  actorHoldsReview: boolean;
  rule: ApprovalRule;
}): ApprovalRefusal | null {
  if (a.actorId === a.reporterId) return "reporter";
  if (a.actorId === a.reviewerId) {
    if (a.rule !== "reviewerMayApprove") return "reviewerNeedsIndependent";
    return a.actorHoldsReview || a.actorHoldsApprove ? null : "notApprover";
  }
  if (!a.actorHoldsApprove) return "notApprover";
  return null;
}
