import type { ErrorDetail } from "@isms/domain";
import { z } from "zod";
import "./zod.js";

/**
 * Machine reasons a `409 CONFLICT` can carry (P2-R8), as `details[].path = "<reason>"` or
 * `"<reason>.<item>"`; `confirmationMismatch` comes with a 400 (a typed confirmation). The web maps reasons to its own messages and never shows API text.
 */
export const ConflictReasonSchema = z
  .enum([
    "lastAdministrator",
    "duplicateRoleAssignment",
    "siteInUse",
    "departmentInUse",
    "setupIncomplete",
    "staleVersion",
    "riskNotEditable",
    "invalidTransition",
    "submitBlocked",
    "approvalRefused",
    "aiUnavailable",
    "conversationClosed",
    "evidenceHashMismatch",
    "controlNotAccepted",
    "controlHasOpenRequest",
    "duplicateRiskControl",
    "taskClosed",
    "openTreatmentActions",
    "treatmentIsAccept",
    "riskClosed",
    "taskNotAssignee",
    "secretsKeyMissing",
    "keyUnreadable",
    "reportTooLarge",
    "narrativeUnverifiable",
    "confirmationMismatch",
  ])
  .openapi("ConflictReason");
export type ConflictReason = z.infer<typeof ConflictReasonSchema>;

const isConflictReason = (value: string): value is ConflictReason =>
  (ConflictReasonSchema.options as readonly string[]).includes(value);

/** One conflict detail: the path is `reason`, or `reason.item` when an item is named. */
export function conflictDetail(
  reason: ConflictReason,
  item?: string,
  message: string = reason,
): ErrorDetail {
  return { path: item === undefined ? reason : `${reason}.${item}`, message };
}

/** The known conflict reasons in `details`, in order; paths with another reason are ignored. */
export function conflictReasons(
  details: readonly ErrorDetail[],
): { reason: ConflictReason; item: string | null }[] {
  const out: { reason: ConflictReason; item: string | null }[] = [];
  for (const { path } of details) {
    const dot = path.indexOf(".");
    const reason = dot === -1 ? path : path.slice(0, dot);
    if (isConflictReason(reason))
      out.push({ reason, item: dot === -1 ? null : path.slice(dot + 1) });
  }
  return out;
}
