import { z } from "zod";

/** Payload schema per job. The job name is also the BullMQ queue name. */
export const JobContracts = {
  "system.heartbeat": z.object({ at: z.iso.datetime() }),
  /** Embeds library controls that are new or changed (run by the worker at start). */
  "library.embed": z.object({ requestedAt: z.iso.datetime() }),
  /** AI control suggestions for a risk; `version` is informational (suggestions are versionless). */
  "risk.suggest_controls": z.object({
    riskId: z.uuid(),
    requestedById: z.uuid(),
    version: z.number().int(),
  }),
  /** Evaluates and rewards a submitted concern when the feature and AI are available. */
  "concern.evaluate": z.object({ evaluationId: z.uuid() }),
  /**
   * Daily: creates "Review this risk" tasks for risks whose review is due. A job scheduler has a
   * fixed payload, so `runOn` (the date it was scheduled) is informational; the handler uses
   * the current date.
   */
  "risk.review_due": z.object({ runOn: z.iso.date() }),
} as const;

export type JobName = keyof typeof JobContracts;
export type JobPayload<N extends JobName> = z.infer<(typeof JobContracts)[N]>;

export const DEAD_LETTER_QUEUE = "dead-letter";

export type DeadLetterPayload = {
  originalQueue: string;
  jobId: string | undefined;
  failedReason: string;
  payload: unknown;
};
