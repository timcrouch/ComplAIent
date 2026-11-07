import "server-only";
import { headers } from "next/headers";
import { cache } from "react";

/** Set by the proxy on every app request (a fresh UUID; any inbound value is replaced). */
export const REQUEST_ID_HEADER = "x-request-id";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The BFF's id for the current server request, forwarded to the API and added to log events.
 * Uses the proxy's id when present. Routes the proxy skips (/auth/*, dotted paths) or code
 * running outside a request get a fresh UUID; a malformed inbound value is never trusted.
 * The upload routes skip the proxy too, so there the inbound header is the client's own: they
 * make their own id (lib/upload.ts) and never call this.
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
