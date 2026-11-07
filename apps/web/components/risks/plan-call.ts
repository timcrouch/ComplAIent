import { conflictReasons } from "@isms/contracts";
import type messages from "../../messages/index";
import type { CallResult } from "../../lib/server-api";
import { settle, signInAgain, type Failure } from "./risk-call";

export type PlanErrorKey = keyof (typeof messages)["insights"]["plan"]["errors"];

const REASONS: readonly PlanErrorKey[] = [
  "taskNotAssignee",
  "invalidTransition",
  "taskClosed",
  "riskClosed",
  "treatmentIsAccept",
];

/** The plain reason for a refused treatment-plan call; the API's own text is never shown. */
export function planErrorKey(failure: Failure): PlanErrorKey {
  switch (failure.kind) {
    case "conflict": {
      const reason = conflictReasons(failure.details)[0]?.reason;
      return REASONS.find((r) => r === reason) ?? "invalid";
    }
    case "invalid":
      return failure.details.some((d) => d.path.endsWith("dueDate")) ? "dueDatePast" : "invalid";
    case "forbidden":
      return "forbidden";
    case "not-found":
      return "notFound";
    default:
      return "unavailable";
  }
}

/** Runs one plan or task call: ok, or the plain reason it was refused. */
export async function planCall(
  call: () => Promise<CallResult<unknown>>,
): Promise<{ ok: true } | { ok: false; error: PlanErrorKey }> {
  const result = await settle(call);
  if (result.ok) return { ok: true };
  signInAgain(result);
  return { ok: false, error: planErrorKey(result) };
}
