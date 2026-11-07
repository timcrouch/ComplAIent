import type { NextRequest } from "next/server";
import { NO_STORE, redirectTo, redirectToUrl } from "../../../lib/auth-responses";
import { sessionCookie, webBaseUrl } from "../../../lib/cookie";
import { requestLog } from "../../../lib/log";
import { endSessionUrl } from "../../../lib/oidc";
import { endSession } from "../../../lib/session";

export const dynamic = "force-dynamic";

/**
 * CSRF check: the request must come from this origin. Browsers send `Origin` on POST and
 * `Sec-Fetch-Site` on all requests; anything cross-site, same-site (a sibling subdomain) or
 * lacking both headers is refused.
 */
function isSameOrigin(request: NextRequest): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return false;
  const origin = request.headers.get("origin");
  if (origin !== null) return origin === new URL(webBaseUrl()).origin;
  return site === "same-origin";
}

/**
 * POST only: there is no GET handler, so a link or image cannot sign anyone out. The cookie is
 * always cleared and the user always redirected, even when Redis or the IdP fails.
 */
export async function POST(request: NextRequest): Promise<Response> {
  if (!isSameOrigin(request)) return new Response(null, { status: 403, headers: NO_STORE });

  const cookie = sessionCookie();
  const sessionId = request.cookies.get(cookie.name)?.value;
  let idToken: string | undefined;
  if (sessionId) {
    try {
      idToken = await endSession(sessionId);
    } catch (err) {
      // Without the store we have no ID token; end-session with client_id still works.
      (await requestLog()).warn({
        event: "auth.logout_store_failed",
        errorName: (err as Error).name,
      });
    }
  }

  let res: ReturnType<typeof redirectTo>;
  try {
    res = redirectToUrl(await endSessionUrl(idToken));
  } catch {
    res = redirectTo("/");
  }
  res.cookies.delete({ name: cookie.name, ...cookie.options });
  return res;
}
