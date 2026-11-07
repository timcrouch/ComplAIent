import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("notFound");
  }),
}));
vi.mock("../components/status/status-screen", () => ({ StatusScreen: () => null }));

const { failureScreen } = await import("../lib/page-result");

const props = (el: ReactElement) => el.props as { kind: string; retryHref: string };

describe("failureScreen", () => {
  it.each([
    ["signed-out", "/auth/login?returnTo=%2Fsetup"],
    ["reauth", "/auth/login?returnTo=%2Fsetup&stepUp=1"],
  ] as const)("%s sends the user to sign in again", (kind, href) => {
    expect(() => failureScreen({ ok: false, kind, details: [], href }, "/setup")).toThrow(
      `redirect:${href}`,
    );
  });

  it("not-found shows the not-found page", () => {
    expect(() => failureScreen({ ok: false, kind: "not-found", details: [] }, "/setup")).toThrow(
      "notFound",
    );
  });

  it.each([
    ["forbidden", "forbidden", "/"],
    ["unavailable", "unavailable", "/setup/sites"],
    ["conflict", "unavailable", "/setup/sites"],
    ["invalid", "unavailable", "/setup/sites"],
  ] as const)("%s shows the %s screen", (kind, screen, retryHref) => {
    const el = failureScreen({ ok: false, kind, details: [] }, "/setup/sites");
    expect(isValidElement(el)).toBe(true);
    expect(props(el)).toEqual({ kind: screen, retryHref });
  });
});
