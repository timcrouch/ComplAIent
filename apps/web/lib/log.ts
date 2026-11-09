import "server-only";
import { loadConfig, telemetryConfig } from "@isms/config";
import { createLogger } from "@isms/telemetry/logger";
import { requestId } from "./request-id";

type Logger = ReturnType<typeof createLogger>;
let logger: Logger | undefined;

/** The same LOG_LEVEL values the API and worker accept. */
export const logLevelSchema = telemetryConfig.pick({ LOG_LEVEL: true });

/**
 * Server logger. Callers log event names, error classes and API status and error codes only
 * (errorLogFields), never tokens, authorisation codes, messages or URLs.
 */
export function log(): Logger {
  logger ??= createLogger({ level: loadConfig(logLevelSchema).LOG_LEVEL, service: "isms-web" });
  return logger;
}

/** The server logger bound to the current request's id (see request-id.ts). */
export async function requestLog(): Promise<Logger> {
  return log().child({ requestId: await requestId() });
}
