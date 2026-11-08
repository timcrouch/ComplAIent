import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "./memory-store";

// The proxy skips /auth/*, so the inbound x-request-id is whatever the client sent.
const CLIENT_ID = "3b241101-e2bb-4255-8caf-4136c566a962";
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers({ "x-request-id": CLIENT_ID })),
}));

const store = new MemoryStore();
vi.mock("../lib/redis", () => ({ getStore: () => store }));
vi.mock("../lib/oidc", () => ({
  buildAuthorizationUrl: vi.fn(),
  handleCallback: vi.fn(),
  endSessionUrl: vi.fn(),
  refresh: vi.fn(),
}));

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

const oidc = await import("../lib/oidc");
const { log } = await import("../lib/log");
const login = await import("../app/auth/login/route");
const callback = await import("../app/auth/callback/route");
const logout = await import("../app/auth/logout/route");
const { saveLoginState } = await import("../lib/login-state");

const BASE = "http://localhost:3000";
const STATE = "s".repeat(43);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const req = (path: string, init?: ConstructorParameters<typeof NextRequest>[1]) =>
  new NextRequest(new URL(path, BASE), {
    ...init,
    headers: { ...(init?.headers as Record<string, string>), "x-request-id": CLIENT_ID },
  });

/** The request ids bound to the log events written while `run` ran. */
async function loggedIds(run: () => Promise<unknown>): Promise<unknown[]> {
  const child = vi.spyOn(log(), "child");
  await run();
  const ids = child.mock.calls.map(([bindings]) => (bindings as { requestId?: unknown }).requestId);
  child.mockRestore();
  return ids;
}

beforeEach(() => {
  store.data.clear();
  fetchMock.mockReset();
  vi.mocked(oidc.buildAuthorizationUrl).mockReset();
  vi.mocked(oidc.handleCallback).mockReset();
  vi.mocked(oidc.endSessionUrl).mockReset();
});

describe("auth routes mint their own request id", () => {
  it("callback: one fresh id for the /me call and its log events, never the client's", async () => {
    await saveLoginState({
      state: STATE,
      codeVerifier: "verifier-1",
      nonce: "nonce-1",
      returnTo: "/",
    });
    vi.mocked(oidc.handleCallback).mockResolvedValue({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      idToken: "id-token-1",
      expiresAt: Date.now() + 300_000,
      refreshExpiresAt: Date.now() + 1_800_000,
      userSub: "user-1",
    });
    fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));
    const call = () =>
      callback.GET(
        req(`/auth/callback?code=c1&state=${STATE}`, {
          headers: { cookie: `isms_login=${STATE}` },
        }),
      );
    const ids = await loggedIds(call);
    const sent = new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("x-request-id");
    expect(sent).toMatch(UUID);
    expect(sent).not.toBe(CLIENT_ID);
    // The /me failure is logged (auth.theme_unavailable) with the same id.
    expect(ids).toContain(sent);
    expect(ids).not.toContain(CLIENT_ID);
  });

  it("callback: a failure is logged with a fresh id", async () => {
    const ids = await loggedIds(() => callback.GET(req("/auth/callback?code=c1")));
    expect(ids).toHaveLength(1);
    expect(ids[0]).toMatch(UUID);
    expect(ids[0]).not.toBe(CLIENT_ID);
  });

  it("login: an unreachable IdP is logged with a fresh id", async () => {
    vi.mocked(oidc.buildAuthorizationUrl).mockRejectedValue(new Error("discovery failed"));
    const ids = await loggedIds(() => login.GET(req("/auth/login")));
    expect(ids).toHaveLength(1);
    expect(ids[0]).toMatch(UUID);
    expect(ids[0]).not.toBe(CLIENT_ID);
  });

  it("logout: a store failure is logged with a fresh id", async () => {
    vi.spyOn(store, "get").mockRejectedValueOnce(new Error("ECONNREFUSED"));
    vi.mocked(oidc.endSessionUrl).mockResolvedValue(new URL("http://idp.test/logout"));
    const ids = await loggedIds(() =>
      logout.POST(
        req("/auth/logout", {
          method: "POST",
          headers: { origin: BASE, cookie: `isms_session=${"z".repeat(43)}` },
        }),
      ),
    );
    expect(ids).toHaveLength(1);
    expect(ids[0]).toMatch(UUID);
    expect(ids[0]).not.toBe(CLIENT_ID);
  });
});
