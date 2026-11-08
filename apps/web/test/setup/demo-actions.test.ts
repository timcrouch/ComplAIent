import { demoRoutes } from "@isms/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CallResult } from "../../lib/server-api";

// The API call, the cookie store and the redirect are replaced; the session cookie's settings
// are the real ones (from the unit-test WEB_BASE_URL, plain http on localhost).
vi.mock("../../lib/server-api", () => ({ callApi: vi.fn() }));
const deleteCookie = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ delete: deleteCookie }),
}));
/** Like Next.js, `redirect` throws, so the action never returns after it. */
class Redirect extends Error {
  constructor(readonly to: string) {
    super("NEXT_REDIRECT");
  }
}
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Redirect(to);
  }),
}));

const { callApi } = await import("../../lib/server-api");
const { redirect } = await import("next/navigation");
const { loadSampleData, resetEverything } = await import("../../app/(app)/setup/demo-actions");

const actions = [
  ["loadSampleData", loadSampleData, demoRoutes.loadSample],
  ["resetEverything", resetEverything, demoRoutes.reset],
] as const;

beforeEach(() => {
  vi.mocked(callApi).mockReset();
  vi.mocked(redirect).mockClear();
  deleteCookie.mockReset();
});

describe.each(actions)("%s (Setup → Demo and training)", (_name, action, route) => {
  it("on success: calls the API, clears the session cookie and goes to sign-in", async () => {
    vi.mocked(callApi).mockResolvedValue({ ok: true, data: {} as never });
    const error = await action("Isarwerk Finanz AG (sample)").then(
      () => null,
      (err: unknown) => err,
    );
    expect(callApi).toHaveBeenCalledExactlyOnceWith(
      route,
      { body: { confirm: "Isarwerk Finanz AG (sample)" } },
      { returnTo: "/setup" },
    );
    // The server ended every session, so the cookie points at nothing.
    expect(deleteCookie).toHaveBeenCalledExactlyOnceWith({
      name: "isms_session",
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
    });
    expect(redirect).toHaveBeenCalledExactlyOnceWith("/");
    expect(error).toBeInstanceOf(Redirect);
    expect(deleteCookie.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(redirect).mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("on a refusal: returns it, and keeps the cookie and the page", async () => {
    const refusal: CallResult<never> = {
      ok: false,
      kind: "reauth",
      details: [],
      href: "/auth/step-up",
    };
    vi.mocked(callApi).mockResolvedValue(refusal);
    expect(await action("RESET")).toEqual(refusal);
    expect(deleteCookie).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("refuses input that breaks the contract as invalid, without calling the API", async () => {
    const result = await action("x".repeat(301));
    expect(result).toMatchObject({ ok: false, kind: "invalid" });
    expect(callApi).not.toHaveBeenCalled();
    expect(deleteCookie).not.toHaveBeenCalled();
  });
});
