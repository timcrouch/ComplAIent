import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { RouteDef } from "@isms/contracts";
import helmet from "helmet";
import { Logger } from "nestjs-pino";
import { requestIdMiddleware } from "./request-id.js";

const JSON_BODY_LIMIT = "1mb";

/** Byte limits of raw-body upload routes, by the config name their contract declares. */
export type UploadLimits = Record<NonNullable<RouteDef["upload"]>["maxBytesConfig"], number>;

/** Express app setting under which the upload limits are kept for `ContractRoute`. */
export const UPLOAD_LIMITS_SETTING = "isms.uploadLimits";

/**
 * Global HTTP safeguards shared by main.ts and the platform tests: request id first (so
 * every later log line and error carries it), then helmet and the JSON body limit. Upload
 * bodies are never parsed here: `ContractRoute` hands the handler a `RawUpload` that reads
 * the body only after the guards and the service's checks, within `uploadLimits`.
 */
export function configureApp(
  app: INestApplication,
  options: { trustProxy: false | number; uploadLimits?: UploadLimits },
): void {
  const express = app as NestExpressApplication;
  express.set("trust proxy", options.trustProxy);
  express.disable("x-powered-by");
  if (options.uploadLimits) express.set(UPLOAD_LIMITS_SETTING, options.uploadLimits);
  app.use(requestIdMiddleware);
  app.use(helmet());
  express.useBodyParser("json", { limit: JSON_BODY_LIMIT });
  app.useLogger(app.get(Logger));
}
