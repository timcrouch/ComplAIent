import "server-only";
import { headers } from "next/headers";
import { cache } from "react";

/**
 * Replaced by the proxy with a fresh UUID on the paths its matcher covers (when the session
 * cookie is present). On the paths it skips the header is whatever the client sent.
 */
export const REQUEST_ID_HEADER = "x-request-id";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The BFF's id for the current server request, forwarded to the API and added to log events.
 * Returns the inbound `x-request-id` when it is a UUID, else a fresh UUID (also outside a
 * request). The value is trustworthy only on paths the proxy matches, where it was replaced.
 * On a path the proxy skips (see `config.matcher` in proxy.ts: /auth/*, paths ending in a
 * file extension, the upload routes) a UUID-shaped value is the client's own and would be
 * returned as is, and so would reach the logs and, through `apiCall`, the API. A handler there
 * that calls the API mints its own id and passes it on instead, as lib/upload.ts and the report
 * file route (/reports/files/[file]) do.
 * Memoised per request in server components (React cache).
 */
export const requestId = cache(async (): Promise<string> => {
  try {
    const value = (await headers()).get(REQUEST_ID_HEADER);
    if (value && UUID.test(value)) return value;
  } catch {
    // Not inside a request (for example a background callback).
  }
  return crypto.randomUUID();
});
