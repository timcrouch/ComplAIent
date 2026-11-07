"use client";

import { conflictReasons, type ReportRiskInput, type RiskDetailDto } from "@isms/contracts";
import { useState } from "react";
import { reportRisk, submitConcern } from "../../lib/actions/report";
import { goTo } from "../../lib/navigate";
import type { CallResult } from "../../lib/server-api";
import { fieldErrors, type FieldErrors, type ReportErrorKey } from "./report-fields";

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

const hasReason = (result: Failure, reason: string): boolean =>
  result.kind === "conflict" && conflictReasons(result.details).some((r) => r.reason === reason);

/** The AI turn could not run: the conversation stays open, and the form takes over. */
export const aiFailed = (result: Failure): boolean => hasReason(result, "aiUnavailable");

/** Another turn for the same conversation wrote first (a double submit). */
export const staleTurn = (result: Failure): boolean => hasReason(result, "staleVersion");

/** The conversation a failed first turn kept, named in the 409's details. */
export function keptConversationId(result: Failure): string | null {
  return result.details.find((d) => d.path === "conversationId")?.message ?? null;
}

/** The plain message for a refused call; the API's own text is never shown. */
export function failureMessage(result: Failure): ReportErrorKey {
  if (result.kind === "forbidden") return "forbidden";
  if (hasReason(result, "conversationClosed")) return "closed";
  if (result.kind === "unavailable") return "unavailable";
  return "notAccepted";
}

/**
 * Sends a checked report, through the conversation when there is one (so it keeps its
 * transcript) or with the form alone. Field problems come back to the caller to place.
 */
export function useReportSubmit(
  conversationId: string | null,
  onDone: (risk: RiskDetailDto) => void,
) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReportErrorKey | null>(null);

  async function submit(input: ReportRiskInput): Promise<FieldErrors | null> {
    if (busy) return null;
    setBusy(true);
    setError(null);
    const result = await settle(() =>
      conversationId ? submitConcern(conversationId, input) : reportRisk(input),
    );
    setBusy(false);
    if (result.ok) {
      onDone(result.data);
      return null;
    }
    if (signInAgain(result)) return null;
    if (result.kind === "invalid") {
      const errors = fieldErrors(result.details.map((d) => ({ path: d.path, code: d.message })));
      setError("summary");
      return errors;
    }
    setError(failureMessage(result));
    return null;
  }

  return { busy, error, setError, submit };
}
