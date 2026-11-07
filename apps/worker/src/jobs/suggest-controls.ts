import { suggestControlsForRisk, type SuggestControlsDeps } from "@isms/ai";
import type { JobAttempt, JobPayload } from "@isms/jobs";

export type JobLogger = {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
};

/** Called directly (tests): treated as the only attempt. */
const ONLY_ATTEMPT: JobAttempt = { attempt: 1, maxAttempts: 1 };

/**
 * `risk.suggest_controls`: runs the suggestion and records the result on the risk as `ready`, or
 * `failed` with the reason. The request's version is not checked: suggestions are versionless.
 * Writes no AuditEvent (P3-R18).
 *
 * An unexpected error is rethrown so BullMQ retries it. The risk stays `pending` until the last
 * attempt, which marks it `failed`/`unavailable`. A retry after a successful AI call makes a
 * second (paid) call (ADR-0011).
 */
export async function suggestControls(
  deps: SuggestControlsDeps & { logger?: JobLogger },
  payload: JobPayload<"risk.suggest_controls">,
  attempt: JobAttempt = ONLY_ATTEMPT,
): Promise<void> {
  const { db, logger } = deps;
  const markFailed = (reason: string) =>
    db.risk.updateMany({
      where: { id: payload.riskId },
      data: { controlSuggestion: "failed", controlSuggestionFailure: reason },
    });
  let result;
  try {
    result = await suggestControlsForRisk(deps, payload.riskId, payload.requestedById);
  } catch (error) {
    if (attempt.attempt >= attempt.maxAttempts) {
      try {
        await markFailed("unavailable");
      } catch (markError) {
        logger?.error(
          {
            job: "risk.suggest_controls",
            errName: markError instanceof Error ? markError.name : "unknown",
          },
          "could not mark control suggestions failed",
        );
      }
    }
    throw error;
  }
  if (result.ok) {
    await db.risk.updateMany({
      where: { id: payload.riskId },
      data: { controlSuggestion: "ready", controlSuggestionFailure: null },
    });
    logger?.info(
      { job: "risk.suggest_controls", added: result.added, discarded: result.discarded },
      "control suggestions ready",
    );
    return;
  }
  await markFailed(result.reason);
  logger?.warn(
    { job: "risk.suggest_controls", reason: result.reason },
    "control suggestions failed",
  );
}
