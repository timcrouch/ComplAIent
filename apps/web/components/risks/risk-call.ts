import { conflictReasons } from "@isms/contracts";
import type messages from "../../messages/index";
import { goTo } from "../../lib/navigate";
import type { CallResult } from "../../lib/server-api";

export type RiskErrorKey = keyof (typeof messages)["risks"]["errors"] | "residual";

const RESIDUAL_FIELDS = ["residualLikelihood", "residualImpact"];
const SHARED_FIELDS = ["likelihood", "impact"];
/** The API's messages for residual refusals (risk-edit.service.ts); likelihood/impact 400s without them are other problems. */
const RESIDUAL_MESSAGES = [
  "Expected likelihood and impact cannot exceed the current ones",
  "An accepted risk has no expected score",
];
export type Failure = Exclude<CallResult<unknown>, { ok: true }>;

/** A server action that could not be reached at all (network, deployment in progress). */
export async function settle<T>(call: () => Promise<CallResult<T>>): Promise<CallResult<T>> {
  try {
    return await call();
  } catch {
    return { ok: false, kind: "unavailable", details: [] };
  }
}

/** Sends a step-up or ended session to sign in; true when it did. */
export function signInAgain(result: Failure): boolean {
  if (result.kind !== "signed-out" && result.kind !== "reauth") return false;
  if (result.href) goTo(result.href);
  return true;
}

/** Someone else saved the risk first: the page must reload before another change. */
export function isStale(result: Failure): boolean {
  return (
    result.kind === "conflict" &&
    conflictReasons(result.details).some((r) => r.reason === "staleVersion")
  );
}

/** The plain message for a refused call; the API's own text is never shown. */
export function riskFailureMessage(result: Failure): RiskErrorKey {
  switch (result.kind) {
    case "forbidden":
      return "forbidden";
    case "not-found":
      return "notFound";
    case "invalid":
      if (result.details.some((d) => d.path.endsWith("ownerId"))) return "owner";
      if (
        result.details.some(
          (d) =>
            RESIDUAL_FIELDS.some((p) => d.path.endsWith(`changes.${p}`)) ||
            (SHARED_FIELDS.some((p) => d.path.endsWith(`changes.${p}`)) &&
              RESIDUAL_MESSAGES.some((m) => d.message.includes(m))),
        )
      ) {
        return "residual";
      }
      return "invalid";
    case "conflict": {
      const reason = conflictReasons(result.details)[0]?.reason;
      switch (reason) {
        case "riskNotEditable":
          return "notEditable";
        case "duplicateRiskControl":
          return "duplicate";
        case "controlNotAccepted":
          return "controlNotAccepted";
        case "controlHasOpenRequest":
          return "controlHasOpenRequest";
        case "aiUnavailable":
          return "aiUnavailable";
        default:
          return "notAccepted";
      }
    }
    default:
      return "unavailable";
  }
}
