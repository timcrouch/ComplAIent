import { loadConfig, oidcConfig, redisConfig, webConfig } from "@isms/config";
import { identityRoutes, MeResponse } from "@isms/contracts";
import { Redis } from "ioredis";
import { NextRequest } from "next/server";
import { z } from "zod";
import { afterAll, describe, expect, it, vi } from "vitest";
import * as callback from "../app/auth/callback/route";
import * as login from "../app/auth/login/route";
import * as logout from "../app/auth/logout/route";
import { apiCall } from "../lib/api-client";
import { loginCookie, sessionCookie } from "../lib/cookie";
import { closeStore } from "../lib/redis";
import { getAccessToken, getSession } from "../lib/session";
import { CookieJar, submitKeycloakLogin } from "./keycloak-form";

/**
 * Full BFF flow against the real local stack (pnpm infra:up, and the API running at
 * API_BASE_URL via `pnpm --filter @isms/api dev`). Route handlers are called directly with a
 * real Redis and a real Keycloak; the browser is scripted. Task 12 adds the Playwright e2e.
 */
const env = loadConfig(
  z.object({
    ...webConfig.shape,
    ...oidcConfig.shape,
    ...redisConfig.shape,
    DEV_USER_PASSWORD: z.string().min(1),
  }),
);
const WEB = env.WEB_BASE_URL;
const redis = new Redis(env.REDIS_URL);

function cookieFrom(res: Response, name: string): string | undefined {
  const line = res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  return line?.split(";", 1)[0]?.slice(name.length + 1);
}

afterAll(async () => {
  vi.restoreAllMocks();
  await closeStore();
  await redis.quit();
});

describe("BFF sign-in against real Keycloak, Redis and API", () => {
  const jar = new CookieJar();
  let sessionId = "";
  let callbackUrl = "";
  let loginState = "";

  it("login redirects to Keycloak with PKCE S256, state and nonce", async () => {
    const res = await login.GET(new NextRequest(`${WEB}/auth/login?returnTo=%2Frisks%3Ftab%3D1`));
    expect(res.status).toBe(303);
    const authorize = new URL(res.headers.get("location") ?? "");
    expect(`${authorize.origin}${authorize.pathname}`).toBe(
      `${env.OIDC_ISSUER_URL}/protocol/openid-connect/auth`,
    );
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize.searchParams.get("redirect_uri")).toBe(`${WEB}/auth/callback`);
    expect(authorize.searchParams.get("scope")).toBe("openid profile email");
    expect(authorize.searchParams.get("nonce")).toBeTruthy();
    loginState = authorize.searchParams.get("state") ?? "";
    expect(cookieFrom(res, loginCookie().name)).toBe(loginState);
    expect(await redis.ttl(`oidc:${loginState}`)).toBeGreaterThan(590);

    callbackUrl = await submitKeycloakLogin(
      authorize.toString(),
      "reporter@example.test",
      env.DEV_USER_PASSWORD,
      jar,
    );
    expect(callbackUrl.startsWith(`${WEB}/auth/callback?`)).toBe(true);
  });

  it("callback creates an encrypted session, sets the cookie and redirects to returnTo", async () => {
    const res = await callback.GET(
      new NextRequest(callbackUrl, {
        headers: { cookie: `${loginCookie().name}=${loginState}` },
      }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${WEB}/risks?tab=1`);
    sessionId = cookieFrom(res, sessionCookie().name) ?? "";
    expect(sessionId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await redis.exists(`oidc:${loginState}`)).toBe(0);

    expect((await getSession(sessionId))?.userSub).toBeTruthy();
    const accessToken = await getAccessToken(sessionId);
    expect(accessToken).toBeTruthy();
    const keys = await redis.keys("sess:*");
    expect(keys.some((k) => k.includes(sessionId))).toBe(false);
    const values = await Promise.all(keys.map((k) => redis.get(k)));
    for (const value of values) {
      expect(value).not.toContain(accessToken);
    }
    const ttls = await Promise.all(keys.map((k) => redis.pttl(k)));
    expect(Math.max(...ttls)).toBeGreaterThan(0);
  });

  it("a replayed callback is rejected", async () => {
    const res = await callback.GET(
      new NextRequest(callbackUrl, { headers: { cookie: `${loginCookie().name}=${loginState}` } }),
    );
    expect(res.headers.get("location")).toBe(`${WEB}/auth/login?error=signin`);
  });

  it("getAccessToken returns a token the API accepts on /api/v1/me", async () => {
    const token = await getAccessToken(sessionId);
    expect(token).toBeTruthy();
    const me = MeResponse.parse(await apiCall(identityRoutes.me, {}, token ?? ""));
    expect(me).toMatchObject({ email: "reporter@example.test" });
    // The Reporter must hold no role in the API's database; if this fails, the baseline
    // assertion below would only be reporting leftover role assignments.
    expect(me.roles).toEqual([]);
    expect([...me.permissions].sort()).toEqual(["me.read", "me.update", "organisation.read"]);
  });

  it("near expiry, getAccessToken refreshes once with Keycloak and the new token works", async () => {
    const before = await getAccessToken(sessionId);
    const view = await getSession(sessionId);
    const realNow = Date.now.bind(Date);
    // The local realm issues 300 s access tokens: 285 s ahead leaves fewer than 30 s.
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + 285_000);
    const tokens = await Promise.all([getAccessToken(sessionId), getAccessToken(sessionId)]);
    vi.restoreAllMocks();
    expect(tokens[0]).toBeTruthy();
    expect(tokens[0]).not.toBe(before);
    expect(tokens[1]).toBe(tokens[0]);
    expect((await getSession(sessionId))?.userSub).toBe(view?.userSub);
    await expect(apiCall(identityRoutes.me, {}, tokens[0] ?? "")).resolves.toMatchObject({
      email: "reporter@example.test",
    });
  });

  it("logout refuses a cross-site POST", async () => {
    const res = await logout.POST(
      new NextRequest(`${WEB}/auth/logout`, {
        method: "POST",
        headers: {
          origin: "https://evil.example",
          cookie: `${sessionCookie().name}=${sessionId}`,
        },
      }),
    );
    expect(res.status).toBe(403);
    expect(await getSession(sessionId)).not.toBeNull();
  });

  it("logout destroys the session and ends the Keycloak session", async () => {
    const res = await logout.POST(
      new NextRequest(`${WEB}/auth/logout`, {
        method: "POST",
        headers: {
          origin: WEB,
          "sec-fetch-site": "same-origin",
          cookie: `${sessionCookie().name}=${sessionId}`,
        },
      }),
    );
    expect(res.status).toBe(303);
    expect(await getSession(sessionId)).toBeNull();
    expect(cookieFrom(res, sessionCookie().name)).toBe("");
    const endSession = new URL(res.headers.get("location") ?? "");
    expect(endSession.searchParams.get("post_logout_redirect_uri")).toBe(`${WEB}/`);
    expect(endSession.searchParams.get("id_token_hint")).toBeTruthy();

    const idp = await fetch(endSession, { redirect: "manual", headers: { cookie: jar.header() } });
    expect(idp.status).toBe(302);
    expect(idp.headers.get("location")).toBe(`${WEB}/`);
  });
});
