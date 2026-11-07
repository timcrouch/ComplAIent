import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "./memory-store";

const store = new MemoryStore();
vi.mock("../lib/redis", () => ({ getStore: () => store }));
vi.mock("../lib/oidc", () => ({
  buildAuthorizationUrl: vi.fn(),
  handleCallback: vi.fn(),
  endSessionUrl: vi.fn(),
  refresh: vi.fn(),
}));

const apiCall = vi.fn();
vi.mock("../lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api-client")>()),
  apiCall: (...args: unknown[]) => apiCall(...args) as unknown,
}));

const oidc = await import("../lib/oidc");
const login = await import("../app/auth/login/route");
const callback = await import("../app/auth/callback/route");
const logout = await import("../app/auth/logout/route");
const { createSession, getSession } = await import("../lib/session");
const { safeReturnTo } = await import("../lib/return-to");

const BASE = "http://localhost:3000";
const STATE = "s".repeat(43);

const sessionTokens = () => ({
  accessToken: "access-1",
  refreshToken: "refresh-1",
  idToken: "id-token-1",
  expiresAt: Date.now() + 300_000,
  refreshExpiresAt: Date.now() + 1_800_000,
  userSub: "user-1",
});

function req(path: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(new URL(path, BASE), init);
}

function cookieValue(res: Response, name: string): string | undefined {
  const line = res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  return line?.split(";", 1)[0]?.slice(name.length + 1);
}

function setCookie(res: Response, name: string): string | undefined {
  return res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
}

async function startLogin(returnTo = "/risks"): Promise<{ res: Response; loginCookie: string }> {
  vi.mocked(oidc.buildAuthorizationUrl).mockResolvedValue({
    url: new URL(`http://idp.test/auth?state=${STATE}`),
    state: STATE,
    codeVerifier: "verifier-1",
    nonce: "nonce-1",
    returnTo: safeReturnTo(returnTo),
  });
  const res = await login.GET(req(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`));
  return { res, loginCookie: cookieValue(res, "isms_login") ?? "" };
}

beforeEach(() => {
  store.data.clear();
  vi.mocked(oidc.buildAuthorizationUrl).mockReset();
  vi.mocked(oidc.handleCallback).mockReset();
  vi.mocked(oidc.endSessionUrl).mockReset();
  vi.restoreAllMocks();
  apiCall.mockReset().mockRejectedValue(new Error("API not arranged in this test"));
});

describe("GET /auth/login", () => {
  it("stores the login state for 10 minutes and redirects to the IdP", async () => {
    const { res, loginCookie } = await startLogin("/risks?tab=1");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`http://idp.test/auth?state=${STATE}`);
    expect(oidc.buildAuthorizationUrl).toHaveBeenCalledWith("/risks?tab=1");
    expect(store.ttl(`oidc:${STATE}`)).toBeGreaterThan(590_000);
    expect(store.data.get(`oidc:${STATE}`)?.value).not.toContain("verifier-1");
    expect(loginCookie).toBe(STATE);
    expect(setCookie(res, "isms_login")).toMatch(/HttpOnly/i);
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("stepUp=1 asks the identity provider for a fresh sign-in (max_age=0)", async () => {
    vi.mocked(oidc.buildAuthorizationUrl).mockResolvedValue({
      url: new URL(`http://idp.test/auth?state=${STATE}&max_age=0`),
      state: STATE,
      codeVerifier: "verifier-1",
      nonce: "nonce-1",
      returnTo: "/setup/people",
      maxAge: 0,
    });
    const res = await login.GET(req("/auth/login?returnTo=%2Fsetup%2Fpeople&stepUp=1"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("max_age=0");
    expect(oidc.buildAuthorizationUrl).toHaveBeenCalledWith("/setup/people", { maxAge: 0 });
  });

  it("answers a client-router (RSC) fetch without starting a flow, so it navigates the page", async () => {
    const res = await login.GET(req("/auth/login?returnTo=%2F", { headers: { rsc: "1" } }));
    expect(res.status).toBe(204);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("content-type") ?? "").not.toContain("text/x-component");
    expect(oidc.buildAuthorizationUrl).not.toHaveBeenCalled();
    expect(store.data.size).toBe(0);
  });

  it("sanitises returnTo", async () => {
    await startLogin("//evil.com");
    expect(oidc.buildAuthorizationUrl).toHaveBeenCalledWith("/");
  });

  it("with an error flag shows a retry page instead of starting a new flow", async () => {
    const res = await login.GET(req("/auth/login?error=signin&returnTo=%2Frisks"));
    expect(res.status).toBe(401);
    expect(oidc.buildAuthorizationUrl).not.toHaveBeenCalled();
    const html = await res.text();
    expect(html).toContain('href="/auth/login?returnTo=%2Frisks"');
    expect(res.headers.get("location")).toBeNull();
  });

  // Task 8 M-4: retrying a failed step-up must ask for a fresh sign-in again.
  it("keeps stepUp on the retry link of a failed step-up", async () => {
    const res = await login.GET(
      req("/auth/login?error=signin&returnTo=%2Fsetup%2Fpeople&stepUp=1"),
    );
    const html = await res.text();
    expect(html).toContain('href="/auth/login?returnTo=%2Fsetup%2Fpeople&#38;stepUp=1"');
  });

  it("shows the retry page with 503 when the IdP is unreachable", async () => {
    vi.mocked(oidc.buildAuthorizationUrl).mockRejectedValue(new Error("discovery failed"));
    const res = await login.GET(req("/auth/login"));
    expect(res.status).toBe(503);
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("GET /auth/callback", () => {
  it("validates state, creates the session, sets the cookie and redirects to returnTo", async () => {
    const { loginCookie } = await startLogin("/risks?tab=1");
    vi.mocked(oidc.handleCallback).mockResolvedValue(sessionTokens());
    const res = await callback.GET(
      req(`/auth/callback?code=c1&state=${STATE}`, {
        headers: { cookie: `isms_login=${loginCookie}` },
      }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${BASE}/risks?tab=1`);
    const [params, stored] = vi.mocked(oidc.handleCallback).mock.calls[0] ?? [];
    expect(params?.get("code")).toBe("c1");
    expect(stored).toMatchObject({ state: STATE, codeVerifier: "verifier-1", nonce: "nonce-1" });

    const sid = cookieValue(res, "isms_session") ?? "";
    expect(sid).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const line = setCookie(res, "isms_session") ?? "";
    expect(line).toMatch(/HttpOnly/i);
    expect(line).toMatch(/SameSite=Lax/i);
    expect(line).toMatch(/Path=\//);
    expect(line).not.toMatch(/Secure/i);
    expect(await getSession(sid)).toMatchObject({ userSub: "user-1" });
    expect(cookieValue(res, "isms_login")).toBe("");
  });

  it("sets the theme cookie from the signed-in user's saved theme (#2)", async () => {
    const { loginCookie } = await startLogin("/");
    vi.mocked(oidc.handleCallback).mockResolvedValue(sessionTokens());
    apiCall.mockResolvedValue({ theme: "dark" });
    const res = await callback.GET(
      req(`/auth/callback?code=c1&state=${STATE}`, {
        headers: { cookie: `isms_login=${loginCookie}; isms_theme=light` },
      }),
    );
    expect(res.status).toBe(303);
    const [route, , token] = (apiCall.mock.calls[0] ?? []) as [unknown, unknown, unknown];
    expect(route).toMatchObject({ method: "get", path: "/api/v1/me" });
    expect(token).toBe("access-1");
    expect(cookieValue(res, "isms_theme")).toBe("dark");
    const line = setCookie(res, "isms_theme") ?? "";
    expect(line).toMatch(/Path=\//);
    expect(line).toMatch(/SameSite=Lax/i);
    expect(line).toMatch(/Max-Age=31536000/i);
  });

  it("clears a previous user's theme cookie when the saved theme cannot be read (#2)", async () => {
    const { loginCookie } = await startLogin("/");
    vi.mocked(oidc.handleCallback).mockResolvedValue(sessionTokens());
    const res = await callback.GET(
      req(`/auth/callback?code=c1&state=${STATE}`, {
        headers: { cookie: `isms_login=${loginCookie}; isms_theme=dark` },
      }),
    );
    expect(res.status).toBe(303);
    expect(cookieValue(res, "isms_session")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(setCookie(res, "isms_theme")).toMatch(/isms_theme=;.*(Max-Age=0|Expires=)/i);
  });

  it("is single-use: replaying the same state fails", async () => {
    const { loginCookie } = await startLogin();
    vi.mocked(oidc.handleCallback).mockResolvedValue(sessionTokens());
    const make = () =>
      req(`/auth/callback?code=c1&state=${STATE}`, {
        headers: { cookie: `isms_login=${loginCookie}` },
      });
    expect((await callback.GET(make())).status).toBe(303);
    const replay = await callback.GET(make());
    expect(replay.headers.get("location")).toBe(`${BASE}/auth/login?error=signin`);
    expect(oidc.handleCallback).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["no state", "/auth/callback?code=c1", true],
    ["unknown state", `/auth/callback?code=c1&state=${"u".repeat(43)}`, true],
    ["malformed state", "/auth/callback?code=c1&state=a%20b", true],
    ["missing login cookie", `/auth/callback?code=c1&state=${STATE}`, false],
  ])("redirects to the login error page on %s", async (_name, path, withCookie) => {
    const { loginCookie } = await startLogin();
    const res = await callback.GET(
      req(path, withCookie ? { headers: { cookie: `isms_login=${loginCookie}` } } : undefined),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toMatch(new RegExp(`^${BASE}/auth/login\\?error=signin`));
    expect(oidc.handleCallback).not.toHaveBeenCalled();
    expect(cookieValue(res, "isms_session")).toBeUndefined();
  });

  it("redirects to the login error page, keeping returnTo, when the exchange fails", async () => {
    const { loginCookie } = await startLogin("/risks");
    vi.mocked(oidc.handleCallback).mockRejectedValue(new Error("nonce mismatch"));
    const res = await callback.GET(
      req(`/auth/callback?code=c1&state=${STATE}`, {
        headers: { cookie: `isms_login=${loginCookie}` },
      }),
    );
    expect(res.headers.get("location")).toBe(`${BASE}/auth/login?error=signin&returnTo=%2Frisks`);
    expect(cookieValue(res, "isms_session")).toBeUndefined();
  });

  it("sends a failed step-up back to a step-up retry", async () => {
    vi.mocked(oidc.buildAuthorizationUrl).mockResolvedValue({
      url: new URL(`http://idp.test/auth?state=${STATE}&max_age=0`),
      state: STATE,
      codeVerifier: "verifier-1",
      nonce: "nonce-1",
      returnTo: "/setup/people",
      maxAge: 0,
    });
    const started = await login.GET(req("/auth/login?returnTo=%2Fsetup%2Fpeople&stepUp=1"));
    const res = await callback.GET(
      req(`/auth/callback?error=access_denied&state=${STATE}`, {
        headers: { cookie: `isms_login=${cookieValue(started, "isms_login") ?? ""}` },
      }),
    );
    expect(res.headers.get("location")).toBe(
      `${BASE}/auth/login?error=signin&returnTo=%2Fsetup%2Fpeople&stepUp=1`,
    );
  });

  it("treats an IdP error response as a failure and consumes the state", async () => {
    const { loginCookie } = await startLogin();
    const res = await callback.GET(
      req(`/auth/callback?error=access_denied&state=${STATE}`, {
        headers: { cookie: `isms_login=${loginCookie}` },
      }),
    );
    expect(res.headers.get("location")).toMatch(/\/auth\/login\?error=signin/);
    expect(oidc.handleCallback).not.toHaveBeenCalled();
    expect(store.data.has(`oidc:${STATE}`)).toBe(false);
  });
});

describe("GET /auth/callback robustness", () => {
  const callbackReq = (cookie: string) =>
    req(`/auth/callback?code=c1&state=${STATE}`, { headers: { cookie } });

  it("destroys the browser's previous session when a new sign-in completes", async () => {
    const old = await createSession(sessionTokens());
    const { loginCookie } = await startLogin();
    vi.mocked(oidc.handleCallback).mockResolvedValue(sessionTokens());
    const res = await callback.GET(callbackReq(`isms_login=${loginCookie}; isms_session=${old}`));
    expect(res.status).toBe(303);
    const fresh = cookieValue(res, "isms_session") ?? "";
    expect(fresh).not.toBe(old);
    expect(await getSession(old)).toBeNull();
    expect(await getSession(fresh)).not.toBeNull();
  });

  it("a store error while reading the login state goes to the error page, not a 500", async () => {
    const { loginCookie } = await startLogin();
    vi.spyOn(store, "getDel").mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const res = await callback.GET(callbackReq(`isms_login=${loginCookie}`));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${BASE}/auth/login?error=signin`);
    expect(oidc.handleCallback).not.toHaveBeenCalled();
  });

  it("a store error while creating the session goes to the error page", async () => {
    const { loginCookie } = await startLogin("/risks");
    vi.mocked(oidc.handleCallback).mockResolvedValue(sessionTokens());
    vi.spyOn(store, "set").mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const res = await callback.GET(callbackReq(`isms_login=${loginCookie}`));
    expect(res.headers.get("location")).toBe(`${BASE}/auth/login?error=signin&returnTo=%2Frisks`);
    expect(cookieValue(res, "isms_session")).toBeUndefined();
  });
});

describe("POST /auth/logout", () => {
  it("does not export GET, so a GET cannot log anyone out", () => {
    expect((logout as Record<string, unknown>).GET).toBeUndefined();
  });

  it.each([
    ["a cross-site Origin", { origin: "https://evil.example" }],
    ["a cross-site fetch", { origin: BASE, "sec-fetch-site": "cross-site" }],
    ["a same-site (not same-origin) fetch", { "sec-fetch-site": "same-site" }],
    ["no Origin and no Sec-Fetch-Site", {}],
    ['Origin "null"', { origin: "null" }],
  ])("rejects %s with 403 and keeps the session", async (_name, headers) => {
    const sid = await createSession(sessionTokens());
    const res = await logout.POST(
      req("/auth/logout", {
        method: "POST",
        headers: { ...headers, cookie: `isms_session=${sid}` },
      }),
    );
    expect(res.status).toBe(403);
    expect(await getSession(sid)).not.toBeNull();
  });

  it("destroys the session, clears the cookie and redirects to the IdP end-session endpoint", async () => {
    const sid = await createSession(sessionTokens());
    vi.mocked(oidc.endSessionUrl).mockResolvedValue(new URL("http://idp.test/logout?x=1"));
    const res = await logout.POST(
      req("/auth/logout", {
        method: "POST",
        headers: { origin: BASE, "sec-fetch-site": "same-origin", cookie: `isms_session=${sid}` },
      }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://idp.test/logout?x=1");
    expect(oidc.endSessionUrl).toHaveBeenCalledWith("id-token-1");
    expect(await getSession(sid)).toBeNull();
    expect(setCookie(res, "isms_session")).toMatch(/isms_session=;.*(Max-Age=0|Expires=)/i);
    // The next person to sign in on this browser starts from System, not this user's theme (#2).
    expect(setCookie(res, "isms_theme")).toMatch(/isms_theme=;.*(Max-Age=0|Expires=)/i);
  });

  it("accepts Sec-Fetch-Site same-origin without an Origin header", async () => {
    vi.mocked(oidc.endSessionUrl).mockResolvedValue(new URL("http://idp.test/logout"));
    const res = await logout.POST(
      req("/auth/logout", { method: "POST", headers: { "sec-fetch-site": "same-origin" } }),
    );
    expect(res.status).toBe(303);
    expect(oidc.endSessionUrl).toHaveBeenCalledWith(undefined);
  });

  it("on a store error still clears the cookie and uses end-session with client_id only", async () => {
    const sid = await createSession(sessionTokens());
    vi.spyOn(store, "get").mockRejectedValueOnce(new Error("ECONNREFUSED"));
    vi.mocked(oidc.endSessionUrl).mockResolvedValue(new URL("http://idp.test/logout"));
    const res = await logout.POST(
      req("/auth/logout", {
        method: "POST",
        headers: { origin: BASE, cookie: `isms_session=${sid}` },
      }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://idp.test/logout");
    expect(oidc.endSessionUrl).toHaveBeenCalledWith(undefined);
    expect(setCookie(res, "isms_session")).toMatch(/isms_session=;/);
    // `get` failed but `del` works: the session must still be removed from the store.
    expect(store.data.size).toBe(0);
  });

  it("with both the store and the IdP down, clears the cookie and goes home", async () => {
    vi.spyOn(store, "get").mockRejectedValueOnce(new Error("ECONNREFUSED"));
    vi.mocked(oidc.endSessionUrl).mockRejectedValue(new Error("discovery failed"));
    const res = await logout.POST(
      req("/auth/logout", {
        method: "POST",
        headers: { origin: BASE, cookie: `isms_session=${"z".repeat(43)}` },
      }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${BASE}/`);
    expect(setCookie(res, "isms_session")).toMatch(/isms_session=;/);
  });

  it("still signs out locally and goes home when the IdP is unreachable", async () => {
    const sid = await createSession(sessionTokens());
    vi.mocked(oidc.endSessionUrl).mockRejectedValue(new Error("discovery failed"));
    const res = await logout.POST(
      req("/auth/logout", {
        method: "POST",
        headers: { origin: BASE, cookie: `isms_session=${sid}` },
      }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${BASE}/`);
    expect(await getSession(sid)).toBeNull();
  });
});
