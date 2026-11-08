import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { headers } from "next/headers";
import { cache } from "react";

/**
 * Replaced by the proxy with a fresh UUID on the paths its matcher covers (when the session
 * cookie is present). On the paths it skips the header is whatever the client sent.
 */
export const REQUEST_ID_HEADER = "x-request-id";

const handlerId = new AsyncLocalStorage<string>();

/**
 * Runs `fn` with `id` as the request id: `requestId()`, and so `apiCall`, `requestLog` and
 * everything they reach, use it instead of the inbound header. For route handlers the proxy
 * skips, which mint their own id.
 */
export function withRequestId<T>(id: string, fn: () => Promise<T>): Promise<T> {
  return handlerId.run(id, fn);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The BFF's id for the current server request, forwarded to the API and added to log events.
 * Inside `withRequestId` it returns that id. Otherwise it returns the inbound `x-request-id`
 * when it is a UUID, else a fresh UUID (also outside a request). The inbound value is
 * trustworthy only on paths the proxy matches, where it was replaced. On a path the proxy
 * skips (see `config.matcher` in proxy.ts: /auth/*, paths ending in a file extension, the
 * upload routes) a UUID-shaped value is the client's own, so every route handler there runs
 * inside `withRequestId(crypto.randomUUID(), …)`: the auth routes, lib/upload.ts and the report
 * file route (/reports/files/[file]).
 * Memoised per request in server components (React cache).
 */
export const requestId = cache(async (): Promise<string> => {
  const own = handlerId.getStore();
  if (own !== undefined) return own;
  try {
    const value = (await headers()).get(REQUEST_ID_HEADER);
    if (value && UUID.test(value)) return value;
  } catch {
    // Not inside a request (for example a background callback).
  }
  return crypto.randomUUID();
});
