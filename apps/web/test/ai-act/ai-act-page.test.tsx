import { isValidElement, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  permissions: ["aiact.read"] as string[],
  modules: ["eu_ai_act"] as string[],
};
vi.mock("../../lib/current-viewer", () => ({
  requireViewer: () =>
    Promise.resolve({
      ok: true,
      me: {
        id: "me",
        displayName: "Rita Risk",
        permissions: state.permissions,
        modules: state.modules,
      },
    }),
}));
const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({ notFound: () => notFound() }));
vi.mock("../../lib/server-api", () => ({ callApi: vi.fn() }));
vi.mock("../../lib/page-result", () => ({ failureScreen: vi.fn(() => "failure") }));
vi.mock("../../components/status/status-screen", () => ({ StatusScreen: () => null }));

const { callApi } = await import("../../lib/server-api");
const { loadAiActPage, loadFormOptions, systemIdOrNotFound } =
  await import("../../lib/ai-act-page");

beforeEach(() => {
  notFound.mockClear();
  vi.mocked(callApi).mockReset();
  state.permissions = ["aiact.read"];
  state.modules = ["eu_ai_act"];
});

describe("loadAiActPage", () => {
  it("is not found while the module is off, before any permission check", async () => {
    state.modules = [];
    state.permissions = [];
    await expect(loadAiActPage("aiact.read")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("shows the forbidden screen without the permission", async () => {
    const page = await loadAiActPage("aiact.manage");
    expect(page.ok).toBe(false);
    const screen = (page as { screen: ReactElement }).screen;
    expect(isValidElement(screen)).toBe(true);
    expect(screen.props).toEqual({ kind: "forbidden", retryHref: "/" });
  });

  it("returns the viewer with the module on and the permission held", async () => {
    const page = await loadAiActPage("aiact.read");
    expect(page.ok).toBe(true);
  });

  it("treats an id that is not a UUID as not found", () => {
    expect(() => systemIdOrNotFound("nope")).toThrow("NEXT_NOT_FOUND");
    expect(systemIdOrNotFound("3f0c7f0e-8a5b-4d55-9b7c-2f1f6a7a0001")).toBe(
      "3f0c7f0e-8a5b-4d55-9b7c-2f1f6a7a0001",
    );
  });
});

describe("loadFormOptions", () => {
  it("offers only the viewer as owner without users.list", async () => {
    vi.mocked(callApi).mockResolvedValue({
      ok: true,
      data: { departments: [{ id: "d", name: "Lending" }] } as never,
    });
    const me = { id: "me", displayName: "Rita Risk", permissions: ["aiact.manage"] } as never;
    const result = await loadFormOptions(me, "/ai-act/systems/new");
    expect(result).toEqual({
      ok: true,
      options: {
        people: [{ id: "me", displayName: "Rita Risk" }],
        departments: [{ id: "d", name: "Lending" }],
      },
    });
    expect(callApi).toHaveBeenCalledTimes(1);
  });
});
