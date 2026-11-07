import type { NextRequest } from "next/server";
import { redirectTo } from "../../../lib/auth-responses";
import { loginCookie, sessionCookie } from "../../../lib/cookie";
import { requestLog } from "../../../lib/log";
import { takeLoginState } from "../../../lib/login-state";
import type { LoginState, Tokens } from "../../../lib/oidc";
import { handleCallback } from "../../../lib/oidc";
import { safeReturnTo } from "../../../lib/return-to";
import { createSession, destroySession } from "../../../lib/session";

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

  const res = redirectTo(safeReturnTo(stored.returnTo));
  res.cookies.set(cookie.name, sessionId, cookie.options);
  res.cookies.delete({ name: loginCookie().name, ...loginCookie().options });
  return res;
}
