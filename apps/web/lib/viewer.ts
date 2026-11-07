import "server-only";
import { identityRoutes, type MeResponse } from "@isms/contracts";
import { ApiError, apiCall, errorLogFields } from "./api-client";
import { requestLog } from "./log";
import { safeReturnTo } from "./return-to";
import { destroySession, getSession, resolveAccessToken } from "./session";

/**
 * A 401 from the API this soon after sign-in means the API rejects tokens the IdP keeps issuing
 * (no email or no email_verified claim, audience mismatch, clock skew). The IdP's SSO session would sign
 * the user straight back in, so redirecting to sign-in would loop.
 */
const NEW_SESSION_MS = 60_000;

/**
 * Who is looking at the page, validated server-side on every (app) request. The proxy only
 * checks that the cookie exists (and skips dotted paths), so this is the real check.
 *
 * - `signed-out`: no cookie, no server-side session, a failed refresh, or the API answered 401
 *   for a session older than 60 s. The layout redirects once to sign-in.
 * - `sign-in-rejected`: the API answered 401 for a session younger than 60 s. The session is
 *   destroyed and a terminal screen is shown, without redirecting (that would loop).
 * - `sign-in-unavailable`: the IdP cannot be reached, so the token cannot be refreshed. The
 *   session is kept and an error is shown; redirecting would only loop.
 * - `unavailable`: the session store or the API failed. An error is shown.
 */
export type Viewer =
  | { status: "ok"; me: MeResponse }
  | { status: "signed-out" }
  | { status: "sign-in-rejected" }
  | { status: "sign-in-unavailable" }
  | { status: "unavailable" };

export async function resolveViewer(sessionId: string | undefined): Promise<Viewer> {
  if (!sessionId) return { status: "signed-out" };
  let createdAt = 0;
  try {
    const session = await getSession(sessionId);
    if (!session) return { status: "signed-out" };
    createdAt = session.createdAt;
    const token = await resolveAccessToken(sessionId);
    if (token.status === "signed-out") return { status: "signed-out" };
    if (token.status === "unavailable") return { status: "sign-in-unavailable" };
    const me = await apiCall(identityRoutes.me, {}, token.accessToken);
    return { status: "ok", me };
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      if (Date.now() - createdAt >= NEW_SESSION_MS) return { status: "signed-out" };
      (await requestLog()).warn({ event: "auth.token_rejected_after_sign_in" });
      try {
        await destroySession(sessionId);
      } catch (destroyErr) {
        (await requestLog()).warn({
          event: "web.session_destroy_failed",
          errorName: (destroyErr as Error).name,
        });
      }
      return { status: "sign-in-rejected" };
    }
    (await requestLog()).warn({ event: "web.viewer_unavailable", ...errorLogFields(err) });
    return { status: "unavailable" };
  }
}

/** Sign-in again, asking the IdP for a fresh authentication (`max_age=0`), then back to `path`. */
export function stepUpPath(path: string | null): string {
  return `${loginPath(path)}&stepUp=1`;
}

/** The sign-in URL that brings the user back to `path` (sanitised; "/" if unsafe). */
export function loginPath(path: string | null): string {
  return `/auth/login?returnTo=${encodeURIComponent(safeReturnTo(path))}`;
}
