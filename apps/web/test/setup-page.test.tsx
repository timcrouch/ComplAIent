import { isValidElement, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { permissions: ["me.read", "organisation.read"] as string[] };
vi.mock("../lib/current-viewer", () => ({
  requireViewer: () => Promise.resolve({ ok: true, me: { permissions: state.permissions } }),
}));
vi.mock("../lib/server-api", () => ({ callApi: vi.fn() }));
vi.mock("../lib/page-result", () => ({ failureScreen: vi.fn(() => "failure") }));
vi.mock("../components/status/status-screen", () => ({ StatusScreen: () => null }));

const { callApi } = await import("../lib/server-api");
const { loadSetupPage } = await import("../lib/setup-page");

beforeEach(() => {
  vi.mocked(callApi)
    .mockReset()
    .mockResolvedValue({ ok: true, data: { setup: {} } as never });
});

describe("loadSetupPage", () => {
  it("shows the forbidden screen without calling the API to someone who cannot manage", async () => {
    state.permissions = ["me.read", "organisation.read"];
    const page = await loadSetupPage("/setup/sites");
    expect(page.ok).toBe(false);
    const screen = (page as { screen: ReactElement }).screen;
    expect(isValidElement(screen)).toBe(true);
    expect(screen.props).toEqual({ kind: "forbidden", retryHref: "/" });
    expect(callApi).not.toHaveBeenCalled();
  });

  it("loads the organisation, returning to the page after sign-in", async () => {
    state.permissions = ["organisation.manage"];
    expect(await loadSetupPage("/setup/sites")).toEqual({ ok: true, organisation: { setup: {} } });
    expect(vi.mocked(callApi).mock.calls[0]?.[2]).toEqual({ returnTo: "/setup/sites" });
  });
});
