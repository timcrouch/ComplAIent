import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/session", () => ({
  destroySession: vi.fn(),
  getSession: vi.fn(),
  resolveAccessToken: vi.fn(),
}));
vi.mock("../lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("../lib/api-client")>("../lib/api-client");
  return { ApiError: actual.ApiError, errorLogFields: actual.errorLogFields, apiCall: vi.fn() };
});

const { destroySession, getSession, resolveAccessToken } = await import("../lib/session");
const { ApiError, apiCall } = await import("../lib/api-client");
const { loginPath, resolveViewer } = await import("../lib/viewer");

const ID = "s".repeat(43);
const me = {
  id: "u1",
  email: "anna@example.test",
  displayName: "Anna Admin",
  roles: [],
  permissions: ["me.read" as const],
  viewMode: "guided" as const,
};

beforeEach(() => {
  vi.mocked(getSession)
    .mockReset()
    .mockResolvedValue({ userSub: "sub", expiresAt: 0, createdAt: Date.now() - 120_000 });
  vi.mocked(destroySession).mockReset().mockResolvedValue();
  vi.mocked(resolveAccessToken).mockReset().mockResolvedValue({ status: "ok", accessToken: "tok" });
  vi.mocked(apiCall)
    .mockReset()
    .mockResolvedValue(me as never);
});

describe("resolveViewer", () => {
  it("returns /me for a valid session, calling the API with the session's token", async () => {
    expect(await resolveViewer(ID)).toEqual({ status: "ok", me });
    expect(vi.mocked(apiCall).mock.calls[0]?.[2]).toBe("tok");
  });

  it("is signed-out without a cookie or without a server-side session", async () => {
    expect(await resolveViewer(undefined)).toEqual({ status: "signed-out" });
    vi.mocked(getSession).mockResolvedValue(null);
    expect(await resolveViewer(ID)).toEqual({ status: "signed-out" });
    expect(apiCall).not.toHaveBeenCalled();
  });

  it("is signed-out when the token cannot be refreshed", async () => {
    vi.mocked(resolveAccessToken).mockResolvedValue({ status: "signed-out" });
    expect(await resolveViewer(ID)).toEqual({ status: "signed-out" });
  });

  it("is sign-in-unavailable (no redirect loop) when the IdP cannot be reached", async () => {
    vi.mocked(resolveAccessToken).mockResolvedValue({ status: "unavailable" });
    expect(await resolveViewer(ID)).toEqual({ status: "sign-in-unavailable" });
    expect(apiCall).not.toHaveBeenCalled();
  });

  it("is signed-out when the API rejects the token of an older session with 401", async () => {
    vi.mocked(apiCall).mockRejectedValue(
      new ApiError({ status: 401, code: "UNAUTHENTICATED", message: "no" }),
    );
    expect(await resolveViewer(ID)).toEqual({ status: "signed-out" });
    expect(destroySession).not.toHaveBeenCalled();
  });

  it("is sign-in-rejected and destroys the session when the API rejects a new session", async () => {
    // The IdP just issued this token and would silently issue it again: redirecting would loop.
    vi.mocked(getSession).mockResolvedValue({
      userSub: "sub",
      expiresAt: 0,
      createdAt: Date.now() - 5_000,
    });
    vi.mocked(apiCall).mockRejectedValue(
      new ApiError({ status: 401, code: "UNAUTHENTICATED", message: "no" }),
    );
    expect(await resolveViewer(ID)).toEqual({ status: "sign-in-rejected" });
    expect(destroySession).toHaveBeenCalledWith(ID);
  });

  it("is unavailable when the API or the session store fails", async () => {
    vi.mocked(apiCall).mockRejectedValue(
      new ApiError({ status: 0, code: "INTERNAL", message: "API request failed" }),
    );
    expect(await resolveViewer(ID)).toEqual({ status: "unavailable" });
    vi.mocked(getSession).mockRejectedValue(new Error("redis down"));
    expect(await resolveViewer(ID)).toEqual({ status: "unavailable" });
  });
});

describe("loginPath", () => {
  it("returns to the requested path, sanitised", () => {
    expect(loginPath("/risks?tab=1")).toBe("/auth/login?returnTo=%2Frisks%3Ftab%3D1");
    expect(loginPath("//evil.example")).toBe("/auth/login?returnTo=%2F");
    expect(loginPath(null)).toBe("/auth/login?returnTo=%2F");
  });
});
