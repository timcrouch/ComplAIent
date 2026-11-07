import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { REQUEST_PATH_HEADER } from "../lib/request-path";
import { config, proxy } from "../proxy";

const BASE = "http://localhost:3000";

describe("proxy", () => {
  it("redirects an app route without a session cookie to login with returnTo", () => {
    const res = proxy(new NextRequest(`${BASE}/risks/r1?tab=controls`));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      `${BASE}/auth/login?returnTo=%2Frisks%2Fr1%3Ftab%3Dcontrols`,
    );
  });

  it("lets a request with a session cookie through (validated server-side later)", () => {
    const res = proxy(
      new NextRequest(`${BASE}/risks`, { headers: { cookie: "isms_session=abc" } }),
    );
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("passes the requested path to the app as a request header (for returnTo)", () => {
    const res = proxy(
      new NextRequest(`${BASE}/risks?tab=1`, {
        headers: { cookie: "isms_session=abc", [REQUEST_PATH_HEADER]: "/spoofed" },
      }),
    );
    expect(res.headers.get(`x-middleware-request-${REQUEST_PATH_HEADER}`)).toBe("/risks?tab=1");
    expect(res.headers.get("x-middleware-override-headers")).toContain(REQUEST_PATH_HEADER);
  });

  it("gives every app request a fresh UUID x-request-id, replacing any inbound value", () => {
    const res = proxy(
      new NextRequest(`${BASE}/risks`, {
        headers: { cookie: "isms_session=abc", "x-request-id": "client-chosen-id" },
      }),
    );
    const id = res.headers.get("x-middleware-request-x-request-id");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(res.headers.get("x-middleware-override-headers")).toContain("x-request-id");
  });

  it("leaves the client-navigation cache key (_rsc) out of the return path", () => {
    const res = proxy(
      new NextRequest(`${BASE}/risks?_rsc=abc12&tab=1`, {
        headers: { cookie: "isms_session=abc" },
      }),
    );
    expect(res.headers.get(`x-middleware-request-${REQUEST_PATH_HEADER}`)).toBe("/risks?tab=1");
    const bare = proxy(
      new NextRequest(`${BASE}/?_rsc=abc12`, { headers: { cookie: "isms_session=abc" } }),
    );
    expect(bare.headers.get(`x-middleware-request-${REQUEST_PATH_HEADER}`)).toBe("/");
  });

  it("never redirects /auth/* even if invoked there", () => {
    for (const path of ["/auth/login", "/auth/callback?code=x", "/auth"]) {
      const res = proxy(new NextRequest(`${BASE}${path}`));
      expect(res.headers.get("location")).toBeNull();
    }
  });

  it.each([
    ["/", true],
    ["/risks", true],
    ["/authors", true],
    ["/auth/login", false],
    ["/auth/callback", false],
    ["/_next/static/chunk.js", false],
    ["/_next/image", false],
    ["/favicon.ico", false],
    ["/logo.svg", false],
    // Uploads skip the proxy: it would buffer the body (and cut it off past its limit).
    ["/risks/1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d/evidence", false],
    ["/tasks/1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d/evidence", false],
    ["/risks/1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", true],
    ["/risks/1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d/evidence/x", true],
    ["/tasks", true],
    ["/evidence/1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d/download", true],
  ])("matcher: %s → %s", (url, expected) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(expected);
  });
});
