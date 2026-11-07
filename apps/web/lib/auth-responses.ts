import "server-only";
import { NextResponse } from "next/server";
import messages from "../messages/index";
import { env } from "./env";

/** Auth responses carry credentials or one-time state: never cache them. */
export const NO_STORE = { "cache-control": "no-store", pragma: "no-cache" } as const;

/** 303 to a path on this app, built from WEB_BASE_URL (never from the Host header). */
export function redirectTo(pathAndQuery: string): NextResponse {
  return redirectToUrl(new URL(pathAndQuery, env().WEB_BASE_URL));
}

export function redirectToUrl(url: URL): NextResponse {
  return NextResponse.redirect(url, { status: 303, headers: NO_STORE });
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => `&#${String(c.charCodeAt(0))};`);

/**
 * Terminal page for a failed sign-in. It never redirects on its own: the user retries by
 * clicking, so a failing IdP or callback cannot cause a redirect loop. Task 12 may replace it
 * with a designed page.
 */
export function signInFailedPage(
  returnTo: string,
  status: 401 | 503,
  stepUp = false,
): NextResponse {
  const t = messages.auth.signInFailed;
  // A failed step-up retries as a step-up, or the IdP's session would bring back a stale sign-in.
  const retry = `/auth/login?returnTo=${encodeURIComponent(returnTo)}${stepUp ? "&stepUp=1" : ""}`;
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${escapeHtml(t.title)}</title></head><body><main><h1>${escapeHtml(t.title)}</h1>` +
    `<p>${escapeHtml(t.body)}</p><p><a href="${escapeHtml(retry)}">${escapeHtml(t.retry)}</a></p>` +
    `</main></body></html>`;
  return new NextResponse(html, {
    status,
    headers: {
      ...NO_STORE,
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'none'; base-uri 'none'; form-action 'none'",
    },
  });
}
