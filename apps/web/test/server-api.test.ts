import { identityRoutes } from "@isms/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("../lib/session", () => ({ getSession: vi.fn(), resolveAccessToken: vi.fn() }));
vi.mock("../lib/cookie", () => ({ sessionCookie: () => ({ name: "isms_session", options: {} }) }));
const warn = vi.fn();
vi.mock("../lib/log", () => ({ requestLog: () => Promise.resolve({ warn }) }));
vi.mock("../lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("../lib/api-client")>("../lib/api-client");
  return { ApiError: actual.ApiError, errorLogFields: actual.errorLogFields, apiCall: vi.fn() };
});

const { cookies } = await import("next/headers");
const { getSession, resolveAccessToken } = await import("../lib/session");
const { ApiError, apiCall } = await import("../lib/api-client");
const { callApi } = await import("../lib/server-api");

const ID = "s".repeat(43);
const route = identityRoutes.updatePreferences;
const input = { body: { viewMode: "executive" as const } };

function withCookie(value: string | undefined) {
  vi.mocked(cookies).mockResolvedValue({
    get: () => (value === undefined ? undefined : { name: "isms_session", value }),
  } as never);
}

beforeEach(() => {
  withCookie(ID);
  vi.mocked(getSession)
    .mockReset()
    .mockResolvedValue({ userSub: "sub", expiresAt: 0, createdAt: Date.now() });
  vi.mocked(resolveAccessToken).mockReset().mockResolvedValue({ status: "ok", accessToken: "tok" });
  vi.mocked(apiCall)
    .mockReset()
    .mockResolvedValue({ viewMode: "executive" } as never);
});

describe("callApi", () => {
  it("returns the parsed data and sends the session's token", async () => {
    expect(await callApi(route, input)).toEqual({ ok: true, data: { viewMode: "executive" } });
    expect(apiCall).toHaveBeenCalledWith(route, input, "tok");
  });

  it.each([
    [
      new ApiError({ status: 401, code: "UNAUTHENTICATED", message: "x" }),
      "signed-out",
      "/auth/login?returnTo=%2Fsetup%2Fpeople",
    ],
    [
      new ApiError({ status: 403, code: "RECENT_AUTH_REQUIRED", message: "x" }),
      "reauth",
      "/auth/login?returnTo=%2Fsetup%2Fpeople&stepUp=1",
    ],
    [new ApiError({ status: 403, code: "FORBIDDEN", message: "x" }), "forbidden", undefined],
    [new ApiError({ status: 404, code: "NOT_FOUND", message: "x" }), "not-found", undefined],
    [
      new ApiError({
        status: 409,
        code: "CONFLICT",
        message: "x",
        details: [{ path: "lastAdministrator", message: "m" }],
      }),
      "conflict",
      undefined,
    ],
    [
      new ApiError({ status: 503, code: "AUTH_UNAVAILABLE", message: "x" }),
      "unavailable",
      undefined,
    ],
  ])("maps %s to %s", async (error, kind, href) => {
    vi.mocked(apiCall).mockRejectedValue(error);
    const result = await callApi(route, input, { returnTo: "/setup/people" });
    expect(result).toMatchObject({ ok: false, kind });
    expect(result.ok ? "unexpected" : result.href).toBe(href);
  });

  it("passes conflict details through", async () => {
    vi.mocked(apiCall).mockRejectedValue(
      new ApiError({
        status: 409,
        code: "CONFLICT",
        message: "x",
        details: [{ path: "lastAdministrator", message: "m" }],
      }),
    );
    expect(await callApi(route, input)).toEqual({
      ok: false,
      kind: "conflict",
      details: [{ path: "lastAdministrator", message: "m" }],
    });
  });

  it("passes validation details through for invalid", async () => {
    const details = [{ path: "body.viewMode", message: "Value is not one of the allowed values" }];
    vi.mocked(apiCall).mockRejectedValue(
      new ApiError({ status: 400, code: "VALIDATION_FAILED", message: "x", details }),
    );
    expect(await callApi(route, input)).toEqual({ ok: false, kind: "invalid", details });
  });

  it("defaults returnTo to /", async () => {
    vi.mocked(apiCall).mockRejectedValue(
      new ApiError({ status: 401, code: "UNAUTHENTICATED", message: "x" }),
    );
    const result = await callApi(route, input);
    expect(result).toMatchObject({ kind: "signed-out", href: "/auth/login?returnTo=%2F" });
  });

  it("returns signed-out without calling the API when there is no session cookie", async () => {
    withCookie(undefined);
    expect(await callApi(route, input, { returnTo: "/setup" })).toMatchObject({
      ok: false,
      kind: "signed-out",
      href: "/auth/login?returnTo=%2Fsetup",
    });
    expect(apiCall).not.toHaveBeenCalled();
  });

  it("returns signed-out when the server-side session is gone or the token cannot be used", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect(await callApi(route, input)).toMatchObject({ kind: "signed-out" });
    vi.mocked(getSession).mockResolvedValue({ userSub: "s", expiresAt: 0, createdAt: 0 });
    vi.mocked(resolveAccessToken).mockResolvedValue({ status: "signed-out" });
    expect(await callApi(route, input)).toMatchObject({ kind: "signed-out" });
    expect(apiCall).not.toHaveBeenCalled();
  });

  it("is unavailable when the token cannot be refreshed or the session store fails", async () => {
    vi.mocked(resolveAccessToken).mockResolvedValue({ status: "unavailable" });
    expect(await callApi(route, input)).toMatchObject({ ok: false, kind: "unavailable" });
    vi.mocked(getSession).mockRejectedValue(new Error("redis down"));
    expect(await callApi(route, input)).toMatchObject({ ok: false, kind: "unavailable" });
    expect(apiCall).not.toHaveBeenCalled();
  });

  it("accessTokenFor answers unavailable, not an exception, when the session store fails", async () => {
    const { accessTokenFor } = await import("../lib/server-api");
    vi.mocked(getSession).mockRejectedValue(new Error("redis down"));
    expect(await accessTokenFor("/risks")).toMatchObject({ ok: false, kind: "unavailable" });
    vi.mocked(getSession).mockResolvedValue({ userSub: "s", expiresAt: 0, createdAt: 0 });
    vi.mocked(resolveAccessToken).mockRejectedValue(new Error("redis down"));
    expect(await accessTokenFor("/risks")).toMatchObject({ ok: false, kind: "unavailable" });
  });

  it("is unavailable for non-API errors", async () => {
    vi.mocked(apiCall).mockRejectedValue(new Error("boom"));
    expect(await callApi(route, input)).toMatchObject({ ok: false, kind: "unavailable" });
  });

  it("logs the API status and code of an unavailable call, never its message, URL or token", async () => {
    warn.mockReset();
    vi.mocked(apiCall).mockRejectedValue(
      new ApiError({
        status: 500,
        code: "INTERNAL",
        message: "secret detail at http://api.internal/x",
        requestId: "req-1",
      }),
    );
    expect(await callApi(route, input)).toMatchObject({ ok: false, kind: "unavailable" });
    expect(warn).toHaveBeenCalledWith({
      event: "web.call_unavailable",
      route: "patch /api/v1/me/preferences",
      errorName: "ApiError",
      status: 500,
      code: "INTERNAL",
      apiRequestId: "req-1",
    });
    const logged = JSON.stringify(warn.mock.calls);
    for (const leak of ["secret detail", "http://", "tok"]) expect(logged).not.toContain(leak);

    warn.mockReset();
    vi.mocked(apiCall).mockRejectedValue(new Error("boom at http://x"));
    await callApi(route, input);
    expect(warn).toHaveBeenCalledWith({
      event: "web.call_unavailable",
      route: "patch /api/v1/me/preferences",
      errorName: "Error",
    });
  });

  it("logs when the token cannot be obtained, so an unavailable screen is always explained", async () => {
    warn.mockReset();
    vi.mocked(resolveAccessToken).mockResolvedValue({ status: "unavailable" });
    await callApi(route, input);
    expect(warn).toHaveBeenCalledWith({
      event: "web.call_unavailable",
      route: "patch /api/v1/me/preferences",
      errorName: "TokenUnavailable",
    });
  });
});
