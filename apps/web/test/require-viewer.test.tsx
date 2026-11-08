import { isValidElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Viewer } from "../lib/viewer";

const state = { viewer: { status: "signed-out" } as Viewer, path: "/risks?tab=1" as string | null };

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => ({ value: "s".repeat(43) }) }),
  headers: () => Promise.resolve({ get: () => state.path }),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
}));
vi.mock("../lib/viewer", async () => {
  const actual = await vi.importActual<typeof import("../lib/viewer")>("../lib/viewer");
  return { loginPath: actual.loginPath, resolveViewer: vi.fn(() => Promise.resolve(state.viewer)) };
});
vi.mock("../components/status/status-screen", () => ({ StatusScreen: () => null }));

const { requireViewer } = await import("../lib/current-viewer");
const { StatusScreen } = await import("../components/status/status-screen");

const me = {
  id: "u1",
  email: "rita@example.test",
  displayName: "Rita Reporter",
  roles: [],
  permissions: ["me.read" as const],
  viewMode: "guided" as const,
  theme: "system" as const,
  modules: [],
};

beforeEach(() => {
  state.path = "/risks?tab=1";
});

describe("requireViewer", () => {
  it("returns /me for a signed-in viewer", async () => {
    state.viewer = { status: "ok", me };
    expect(await requireViewer()).toEqual({ ok: true, me });
  });

  it("redirects a signed-out viewer once to sign-in, returning to the requested path", async () => {
    state.viewer = { status: "signed-out" };
    await expect(requireViewer()).rejects.toThrow(
      "redirect:/auth/login?returnTo=%2Frisks%3Ftab%3D1",
    );
    state.path = null; // dotted paths: the proxy did not run
    await expect(requireViewer()).rejects.toThrow("redirect:/auth/login?returnTo=%2F");
  });

  it.each(["sign-in-unavailable", "sign-in-rejected", "unavailable"] as const)(
    "returns the status screen for %s (never a redirect)",
    async (status) => {
      state.viewer = { status };
      const result = await requireViewer();
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(isValidElement(result.screen)).toBe(true);
      expect(result.screen.type).toBe(StatusScreen);
      expect(result.screen.props).toEqual({ kind: status, retryHref: "/risks?tab=1" });
    },
  );
});
