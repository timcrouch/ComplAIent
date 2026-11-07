import "server-only";
import type { RouteDef } from "@isms/contracts";
import { cookies } from "next/headers";
import { ApiError, apiCall, errorLogFields, type RouteInput, type RouteOutput } from "./api-client";
import { sessionCookie } from "./cookie";
import { log, requestLog } from "./log";
import { getSession, resolveAccessToken } from "./session";
import { loginPath, stepUpPath } from "./viewer";

export type CallFailureKind =
  "signed-out" | "reauth" | "forbidden" | "not-found" | "invalid" | "conflict" | "unavailable";

type Detail = { path: string; message: string };

export type CallResult<T> =
  { ok: true; data: T } | { ok: false; kind: CallFailureKind; details: Detail[]; href?: string };

const fail = (kind: CallFailureKind, details: Detail[] = [], href?: string) =>
  ({ ok: false, kind, details, ...(href ? { href } : {}) }) as const;

/** The route template ("get /api/v1/organisation"), never the substituted URL. */
const logRoute = (route: RouteDef) => ({
  event: "web.call_unavailable",
  route: `${route.method} ${route.path}`,
});

export type Failure = Exclude<CallResult<never>, { ok: true }>;

/**
 * The access token of the session in the request's cookie, or why there is none. For route
 * handlers that call the API themselves (file uploads and downloads); everything else uses
 * `callApi`. The token is only ever passed on to the API.
 */
export async function accessTokenFor(
  returnTo: string,
  options: LogOptions = {},
): Promise<{ ok: true; token: string } | Failure> {
  try {
    return await tokenFor(returnTo, null, options);
  } catch (err) {
    // The session store failed (Redis down): an answer, never an exception.
    (await logger(options)).warn({ event: "web.call_unavailable", ...errorLogFields(err) });
    return fail("unavailable");
  }
}

/** A handler that made its own request id (the upload routes) logs with it. */
type LogOptions = { requestId?: string };
const logger = async (options: LogOptions) =>
  options.requestId ? log().child({ requestId: options.requestId }) : requestLog();

async function tokenFor(
  returnTo: string,
  route: RouteDef | null,
  options: LogOptions = {},
): Promise<{ ok: true; token: string } | Failure> {
  const signedOut = fail("signed-out", [], loginPath(returnTo));
  const sessionId = (await cookies()).get(sessionCookie().name)?.value;
  if (!sessionId || !(await getSession(sessionId))) return signedOut;
  const token = await resolveAccessToken(sessionId);
  if (token.status === "signed-out") return signedOut;
  if (token.status === "unavailable") {
    const where = route ? logRoute(route) : { event: "web.call_unavailable" };
    (await logger(options)).warn({ ...where, errorName: "TokenUnavailable" });
    return fail("unavailable");
  }
  return { ok: true, token: token.accessToken };
}

/** What an API failure means for the page; anything unexpected is logged and "unavailable". */
export async function failureOf(
  err: unknown,
  route: RouteDef,
  returnTo: string,
  options: LogOptions = {},
): Promise<Failure> {
  if (err instanceof ApiError) {
    const details = err.details ?? [];
    switch (err.status) {
      case 401:
        return fail("signed-out", [], loginPath(returnTo));
      case 403:
        return err.code === "RECENT_AUTH_REQUIRED"
          ? fail("reauth", [], stepUpPath(returnTo))
          : fail("forbidden");
      case 404:
        return fail("not-found");
      case 400:
        return fail("invalid", details);
      case 409:
        return fail("conflict", details);
    }
  }
  (await logger(options)).warn({ ...logRoute(route), ...errorLogFields(err) });
  return fail("unavailable");
}

/**
 * The web's single server-side path to the API. Reads the session cookie, resolves the access
 * token and calls the route; API outcomes become a `CallResult` and never throw, so pages and
 * server actions decide what to show. Only the API decides what a user may do.
 */
export async function callApi<R extends RouteDef>(
  route: R,
  input: RouteInput<R>,
  options: { returnTo?: string } = {},
): Promise<CallResult<RouteOutput<R>>> {
  const returnTo = options.returnTo ?? "/";
  try {
    const token = await tokenFor(returnTo, route);
    if (!token.ok) return token;
    return { ok: true, data: await apiCall(route, input, token.token) };
  } catch (err) {
    return failureOf(err, route, returnTo);
  }
}
