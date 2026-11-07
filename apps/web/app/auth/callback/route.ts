import { identityRoutes, type Theme } from "@isms/contracts";
import type { NextRequest } from "next/server";
import { apiCall } from "../../../lib/api-client";
import { redirectTo } from "../../../lib/auth-responses";
import { loginCookie, sessionCookie } from "../../../lib/cookie";
import { requestLog } from "../../../lib/log";
import { takeLoginState } from "../../../lib/login-state";
import type { LoginState, Tokens } from "../../../lib/oidc";
import { handleCallback } from "../../../lib/oidc";
import { safeReturnTo } from "../../../lib/return-to";
import { createSession, destroySession } from "../../../lib/session";
import { THEME_COOKIE, themeCookieOptions } from "../../../lib/theme";

export const dynamic = "force-dynamic";

type Reason =
  "missing_state" | "unknown_state" | "browser_mismatch" | "idp_error" | "exchange" | "store";

/**
 * Any failure goes to the login error page exactly once; that page never redirects by itself.
 * Only fixed reason codes are logged — never the code, state, tokens or IdP messages.
 */
async function fail(reason: Reason, stored?: LoginState, err?: unknown): Promise<Response> {
  (await requestLog()).warn({
    event: "auth.callback_failed",
    reason,
    ...(err instanceof Error ? { errorName: err.name } : {}),
  });
  const query = new URLSearchParams({ error: "signin" });
  const returnTo = stored?.returnTo;
  if (returnTo && returnTo !== "/") query.set("returnTo", returnTo);
  // A failed step-up (max_age=0) must retry as one (Task 8 M-4).
  if (stored?.maxAge === 0) query.set("stepUp", "1");
  const res = redirectTo(`/auth/login?${query.toString()}`);
  res.cookies.delete({ name: loginCookie().name, ...loginCookie().options });
  return res;
}

/**
 * The signed-in user's saved theme (#2), or null when it cannot be read. Never fails the sign-in:
 * the theme is presentation only, and the app shell loads /me again anyway.
 */
async function savedTheme(accessToken: string): Promise<Theme | null> {
  try {
    return (await apiCall(identityRoutes.me, {}, accessToken)).theme;
  } catch (err) {
    (await requestLog()).warn({
      event: "auth.theme_unavailable",
      ...(err instanceof Error ? { errorName: err.name } : {}),
    });
    return null;
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  const params = request.nextUrl.searchParams;
  const state = params.get("state");
  if (!state) return fail("missing_state");

  // Consume the state first, so it is single-use even when the callback fails.
  let stored: LoginState | null;
  try {
    stored = await takeLoginState(state);
  } catch (err) {
    return fail("store", undefined, err);
  }
  if (!stored) return fail("unknown_state");
  // Login CSRF: the callback must arrive in the browser that started this login.
  if (request.cookies.get(loginCookie().name)?.value !== state) {
    return fail("browser_mismatch", stored);
  }
  if (params.has("error")) return fail("idp_error", stored);

  let tokens: Tokens;
  try {
    tokens = await handleCallback(params, stored);
  } catch (err) {
    return fail("exchange", stored, err);
  }

  const cookie = sessionCookie();
  let sessionId: string;
  try {
    // A new sign-in replaces any session this browser already had (no orphaned sessions,
    // and no fixation onto a session id that existed before authentication).
    const previous = request.cookies.get(cookie.name)?.value;
    if (previous) await destroySession(previous);
    sessionId = await createSession(tokens);
  } catch (err) {
    return fail("store", stored, err);
  }

  const theme = await savedTheme(tokens.accessToken);
  const res = redirectTo(safeReturnTo(stored.returnTo));
  res.cookies.set(cookie.name, sessionId, cookie.options);
  // The theme follows the user, never the browser: replace whatever the last person chose (#2).
  if (theme) res.cookies.set(THEME_COOKIE, theme, themeCookieOptions(cookie.options.secure));
  else res.cookies.delete({ name: THEME_COOKIE, path: "/" });
  res.cookies.delete({ name: loginCookie().name, ...loginCookie().options });
  return res;
}
