export const RISK_STATES = ["proposed", "in_review", "approved", "returned", "closed"] as const;
export type RiskState = (typeof RISK_STATES)[number];

export const TREATMENTS = ["avoid", "mitigate", "transfer", "accept"] as const;
export type Treatment = (typeof TREATMENTS)[number];

/** A risk can be edited only while proposed or returned. */
export function isEditable(state: RiskState): boolean {
  return state === "proposed" || state === "returned";
}

export type RiskAction = "submit" | "approve" | "return" | "close" | "reassess";

/** The state after an action, or null when the action is not allowed from `state`. */
export function nextState(state: RiskState, action: RiskAction): RiskState | null {
  if (action === "close") return state === "approved" ? "closed" : null;
  if (action === "reassess") return state === "approved" || state === "closed" ? "proposed" : null;
  if (action === "submit") return state === "proposed" || state === "returned" ? "in_review" : null;
  if (state !== "in_review") return null;
  return action === "approve" ? "approved" : "returned";
}

/** Review may be confirmed on approved and closed risks. */
export function mayConfirmReview(state: RiskState): boolean {
  return state === "approved" || state === "closed";
}

/** Actions can be planned unless the risk is closed or the treatment is accept/unset. */
export function mayPlanActions(state: RiskState, treatment: Treatment | null): boolean {
  return state !== "closed" && treatment !== null && treatment !== "accept";
}

export type SubmitBlocker =
  | "missingLikelihood"
  | "missingImpact"
  | "missingTreatment"
  | "missingOwner"
  | "unresolvedToConfirm";

export function submitBlockers(r: {
  likelihood: number | null;
  impact: number | null;
  treatment: Treatment | null;
  ownerId: string | null;
  toConfirm: readonly string[];
}): SubmitBlocker[] {
  const out: SubmitBlocker[] = [];
  if (r.likelihood === null) out.push("missingLikelihood");
  if (r.impact === null) out.push("missingImpact");
  if (r.treatment === null) out.push("missingTreatment");
  if (r.ownerId === null) out.push("missingOwner");
  if (r.toConfirm.length > 0) out.push("unresolvedToConfirm");
  return out;
}

/** Human-facing reference, at least four digits: R-0001. */
export function formatRiskReference(n: number): string {
  return `R-${String(n).padStart(4, "0")}`;
}
