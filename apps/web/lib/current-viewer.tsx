import "server-only";
import type { MeResponse } from "@isms/contracts";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache, type ReactElement } from "react";
import { StatusScreen } from "../components/status/status-screen";
import { sessionCookie } from "./cookie";
import { REQUEST_PATH_HEADER } from "./request-path";
import { safeReturnTo } from "./return-to";
import { loginPath, resolveViewer, type Viewer } from "./viewer";

/** The request's viewer, resolved once per request (React cache) for the layout and its pages. */
const loadViewer = cache(async (): Promise<Viewer> => {
  const store = await cookies();
  return resolveViewer(store.get(sessionCookie().name)?.value);
});

export type RequiredViewer = { ok: true; me: MeResponse } | { ok: false; screen: ReactElement };

/**
 * The session check for everything under app/(app). PATTERN — every (app) layout, page,
 * not-found and catch-all must start with:
 *
 *   const viewer = await requireViewer();
 *   if (!viewer.ok) return viewer.screen;
 *
 * Why every page and not only the layout: on client-side navigation Next.js re-renders only
 * the segments that change, so a shared layout does not run again. A page that skipped this
 * check would render for an ended session.
 *
 * - Signed out: redirects once to sign-in, returning to the requested path (never returns).
 * - IdP, session store or API unavailable: returns an error screen; no redirect, so no loop.
 * - Signed in: returns /me. Pass only the fields a client component needs, never tokens.
 */
export async function requireViewer(): Promise<RequiredViewer> {
  const [viewer, requestHeaders] = await Promise.all([loadViewer(), headers()]);
  if (viewer.status === "ok") return { ok: true, me: viewer.me };
  const path = safeReturnTo(requestHeaders.get(REQUEST_PATH_HEADER));
  if (viewer.status === "signed-out") redirect(loginPath(path));
  return { ok: false, screen: <StatusScreen kind={viewer.status} retryHref={path} /> };
}
