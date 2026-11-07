import type { JobPayload } from "@isms/jobs";

/** Proves the queue-to-worker path end to end; carries no business logic. */
export function heartbeat(
  payload: JobPayload<"system.heartbeat">,
  logger: { info(obj: Record<string, unknown>, msg?: string): void },
): Promise<void> {
  logger.info({ job: "system.heartbeat", at: payload.at });
  return Promise.resolve();
}
