import pino from "pino";
import { REDACTED, isSensitiveKey, scrub } from "./scrub.js";

/** Exact header paths, kept as a second layer behind the recursive scrubber. */
export const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
];

const std = pino.stdSerializers;

/**
 * Serializers whose output is scrubbed. pino-http replaces logger serializers with its own,
 * so the HTTP logger must be given these explicitly (see PlatformModule).
 */
export const loggerSerializers = {
  req: (req: Parameters<typeof std.req>[0]): unknown => scrub(std.req(req)),
  res: (res: Parameters<typeof std.res>[0]): unknown => scrub(std.res(res)),
  err: (err: Parameters<typeof std.err>[0]): unknown => scrub(std.err(err)),
};

export function createLogger(
  opts: { level: string; service: string },
  destination?: pino.DestinationStream,
): pino.Logger {
  const options: pino.LoggerOptions = {
    level: opts.level,
    base: { service: opts.service },
    redact: { paths: REDACT_PATHS, censor: "[Redacted]" },
    serializers: loggerSerializers,
    formatters: {
      // Runs before serializers: scrub everything except keys a serializer handles, whose
      // values may be raw request/response/error objects scrubbed after serialization.
      log: (obj) =>
        Object.fromEntries(
          Object.entries(obj).map(([key, value]) => [
            key,
            key in loggerSerializers ? value : isSensitiveKey(key) ? REDACTED : scrub(value),
          ]),
        ),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  return destination ? pino(options, destination) : pino(options);
}
