import type { NextRequest } from "next/server";
import { NO_STORE, redirectToUrl, signInFailedPage } from "../../../lib/auth-responses";
import { loginCookie } from "../../../lib/cookie";
import { requestLog } from "../../../lib/log";
import { withRequestId } from "../../../lib/request-id";
import { saveLoginState } from "../../../lib/login-state";
import { buildAuthorizationUrl } from "../../../lib/oidc";
import { safeReturnTo } from "../../../lib/return-to";

export const dynamic = "force-dynamic";

const LOGIN_COOKIE_MAX_AGE_S = 10 * 60;

/**
 * Starts sign-in. With `?error=…` (set by a failed callback) it shows a retry page instead.
 * The proxy skips /auth/*, so it logs with its own request id, never the client's.
 */
export function GET(request: NextRequest): Promise<Response> {
  return withRequestId(crypto.randomUUID(), () => start(request));
}

async function start(request: NextRequest): Promise<Response> {
  const returnTo = safeReturnTo(request.nextUrl.searchParams.get("returnTo"));
  const stepUp = request.nextUrl.searchParams.get("stepUp") === "1";
  if (request.nextUrl.searchParams.has("error")) return signInFailedPage(returnTo, 401, stepUp);
  // A server redirect() during client-side navigation makes the Next.js router fetch this URL
  // as RSC. Following our 303 cross-origin to the IdP would fail (CORS) after writing a login
  // state for nothing. A non-RSC response makes the router load the URL as a document instead.
  if (request.headers.get("rsc") === "1")
    return new Response(null, { status: 204, headers: NO_STORE });

  try {
    // Step-up: ask the IdP to authenticate again, so the API sees a fresh auth_time.
    const { url, ...login } = stepUp
      ? await buildAuthorizationUrl(returnTo, { maxAge: 0 })
      : await buildAuthorizationUrl(returnTo);
    await saveLoginState(login);
    const res = redirectToUrl(url);
    for (const [k, v] of Object.entries(NO_STORE)) res.headers.set(k, v);
    const cookie = loginCookie();
    res.cookies.set(cookie.name, login.state, {
      ...cookie.options,
      maxAge: LOGIN_COOKIE_MAX_AGE_S,
    });
    return res;
  } catch (err) {
    (await requestLog()).warn({ event: "auth.login_unavailable", errorName: (err as Error).name });
    return signInFailedPage(returnTo, 503, stepUp);
  }
}
