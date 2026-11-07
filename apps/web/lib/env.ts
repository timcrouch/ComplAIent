import "server-only";
import { loadConfig, oidcConfig, redisConfig, storageConfig, webConfig } from "@isms/config";
import { z } from "zod";
import { webBaseUrlField } from "./web-url";

export const webEnvSchema = z.object({
  ...webConfig.shape,
  // The audience is checked by the API only.
  ...oidcConfig.omit({ OIDC_AUDIENCE: true }).shape,
  ...redisConfig.shape,
  WEB_BASE_URL: webBaseUrlField,
  // The API's own limit (same name and default), checked here before a file is forwarded.
  EVIDENCE_MAX_BYTES: storageConfig.shape.EVIDENCE_MAX_BYTES,
});
export type WebEnv = z.infer<typeof webEnvSchema>;

let cached: WebEnv | undefined;

/**
 * Server configuration. Validated at server start by `instrumentation.ts` (the server refuses
 * to start on invalid config) and lazily on first use, so `next build` needs no env.
 */
export function env(): WebEnv {
  cached ??= loadConfig(webEnvSchema);
  return cached;
}
