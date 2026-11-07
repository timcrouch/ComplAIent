import { NextResponse, type NextRequest } from "next/server";
import { sessionCookie, webBaseUrl } from "./lib/cookie";
import { REQUEST_PATH_HEADER } from "./lib/request-path";
// Not lib/request-id: that module is server-only and reads next/headers.
const REQUEST_ID_HEADER = "x-request-id";
import { safeReturnTo } from "./lib/return-to";

/**
 * Optimistic check only: the proxy does not reach Redis, so it tests that the session cookie
 * is present. The (app) layout validates the session server-side (lib/viewer.ts).
 */
/** Path and query to return to; drops `_rsc`, the cache key of client-side navigations. */
function returnPath(url: URL): string {
  const params = new URLSearchParams(url.search);
  params.delete("_rsc");
  const query = params.toString();
  return query ? `${url.pathname}?${query}` : url.pathname;
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  // Never redirect the sign-in flow itself (the matcher excludes it too).
  if (pathname === "/auth" || pathname.startsWith("/auth/")) return NextResponse.next();
  if (request.cookies.has(sessionCookie().name)) {
    const headers = new Headers(request.headers);
    headers.set(REQUEST_PATH_HEADER, returnPath(request.nextUrl));
    // The BFF's own id for this request; a client-chosen value is never forwarded.
    headers.set(REQUEST_ID_HEADER, crypto.randomUUID());
    return NextResponse.next({ request: { headers } });
  }

  const target = new URL("/auth/login", webBaseUrl());
  target.searchParams.set("returnTo", safeReturnTo(`${pathname}${search}`));
  return NextResponse.redirect(target, 307);
}

export const config = {
  // Everything except the auth flow, Next.js internals, files with an extension and the file
  // uploads: the proxy would buffer an upload's body in memory (and cut it off past its
  // limit). The upload routes check the session themselves before reading anything.
  matcher: [
    "/((?!auth/|auth$|_next/|.*\\.[A-Za-z0-9]+$|risks/[^/]+/evidence$|tasks/[^/]+/evidence$).*)",
  ],
};
